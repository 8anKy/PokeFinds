/**
 * KORTFAKTA-BACKFILL — fyller Card.artist/hp/types/weakness/retreatCost/
 * regulationMark/dexId/flavorText för engelska set. Produktsidans "Om kortet"-
 * panel (lib/product-facts.ts) visar bara det som finns, så varje fyllt fält är
 * en rad mer och ett hål mindre.
 *
 * KÄLLOR, i ordning per set:
 *   1. TCGdex (MIT, ingen nyckel, kommersiellt bruk med attribution) — EN
 *      setlista + ETT anrop per kort som saknar något. Ger illustratör, typer,
 *      svaghet, reträtt, regulation mark, dex-nummer; flavour text bara för en
 *      del set (S&V-eran ja, SWSH nej).
 *   2. pokemontcg.io — ETT anrop per set (250 kort/sida) och bär flavorText för
 *      alla eror, men svarade 500/502 hela 2026-09-22. Körs BARA för kort som
 *      TCGdex lämnade utan flavour text, och ett fel hoppas tyst över.
 *
 * Skrivningen är COALESCE(nytt, gammalt) per fält (tom `types` räknas som
 * okänt) — en tunn källa raderar aldrig en fyllig. Resumerbar via
 * `Card.factsCheckedAt`: ett kort som frågats stämplas oavsett svar (trainers
 * saknar typer och flavour text på riktigt) och hoppas över nästa gång;
 * SKIP_FILLED=0 frågar om allt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-card-facts.ts
 *   … --set sv8          bara ett set (externalId)
 *   … --limit 20         max antal set (nyast först)
 *   … --no-pokemontcg    hoppa över källa 2
 *   … --flavor-only      bara källa 2, bara Pokémon utan flavour text (stämpeln
 *                        ignoreras) — för en omkörning när pokemontcg.io är uppe
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";
import { TCGDEX_BASE, TcgdexUnavailable, tcgdexJson } from "../src/lib/tcgdex";
import {
  factsFromPokemontcg,
  factsFromTcgdex,
  hasAnyFact,
  normalizeCardNumber,
  tcgdexIdMap,
  type CardFactsPatch,
  type TcgdexCardLike,
} from "../src/lib/card-facts-source";
import { fetchTcgCardsForSet } from "../src/scrapers/adapters/pokemontcg-adapter";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] ?? null : null;
};
const SKIP_FILLED = process.env.SKIP_FILLED !== "0";
const ONLY_SET = arg("--set");
const LIMIT = Number(arg("--limit") ?? 0) || 0;
const FLAVOR_ONLY = argv.includes("--flavor-only");
const USE_POKEMONTCG = !argv.includes("--no-pokemontcg") || FLAVOR_ONLY;
const CONCURRENCY = Number(process.env.FACTS_CONCURRENCY ?? 4);
const CHUNK = 500;

type Row = { id: string; number: string; supertype: string | null; artist: string | null; types: string[]; regulationMark: string | null; flavorText: string | null };

async function writePatches(patches: Map<string, CardFactsPatch>): Promise<number> {
  const entries = [...patches.entries()].filter(([, p]) => hasAnyFact(p));
  let n = 0;
  for (let o = 0; o < entries.length; o += CHUNK) {
    const chunk = entries.slice(o, o + CHUNK);
    const rows = Prisma.join(
      chunk.map(
        ([id, p]) =>
          Prisma.sql`(${id}, ${p.artist}, ${p.hp}::int, ${p.types}::text[], ${p.weaknessType}, ${p.weaknessValue}, ${p.retreatCost}::int, ${p.regulationMark}, ${p.dexId}::int, ${p.flavorText})`
      )
    );
    n += await prisma.$executeRaw`
      UPDATE "Card" AS c SET
        "artist" = COALESCE(v.artist, c."artist"),
        "hp" = COALESCE(v.hp, c."hp"),
        "types" = CASE WHEN cardinality(v.types) > 0 THEN v.types ELSE c."types" END,
        "weaknessType" = COALESCE(v.wtype, c."weaknessType"),
        "weaknessValue" = COALESCE(v.wvalue, c."weaknessValue"),
        "retreatCost" = COALESCE(v.retreat, c."retreatCost"),
        "regulationMark" = COALESCE(v.mark, c."regulationMark"),
        "dexId" = COALESCE(v.dex, c."dexId"),
        "flavorText" = COALESCE(v.flavor, c."flavorText")
      FROM (VALUES ${rows}) AS v(id, artist, hp, types, wtype, wvalue, retreat, mark, dex, flavor)
      WHERE c.id = v.id`;
  }
  return n;
}

async function main() {
  const sets = await prisma.cardSet.findMany({
    where: {
      language: "EN",
      ...(ONLY_SET ? { externalId: ONLY_SET } : {}),
    },
    select: { id: true, name: true, externalId: true, tcgdexId: true },
    orderBy: { releaseDate: "desc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`${sets.length} engelska set`);

  let totalWritten = 0;
  let skipped = 0;
  for (const [i, set] of sets.entries()) {
    const where: Prisma.CardWhereInput = { setId: set.id, language: "EN" };
    const cards: Row[] = await prisma.card.findMany({
      where: FLAVOR_ONLY
        ? { ...where, flavorText: null, supertype: "Pokémon" }
        : SKIP_FILLED
          ? { ...where, factsCheckedAt: null }
          : where,
      select: { id: true, number: true, supertype: true, artist: true, types: true, regulationMark: true, flavorText: true },
    });
    const needsCore = cards.filter((c) => !c.artist || c.types.length === 0 || !c.regulationMark);
    if (cards.length === 0) {
      skipped++;
      continue;
    }
    const patches = new Map<string, CardFactsPatch>();

    // 1. TCGdex
    if (!FLAVOR_ONLY && set.tcgdexId && needsCore.length > 0) {
      let list: { cards?: { id: string; localId: string }[] } | null = null;
      try {
        list = await tcgdexJson(`${TCGDEX_BASE}/en/sets/${encodeURIComponent(set.tcgdexId)}`);
      } catch (err) {
        if (!(err instanceof TcgdexUnavailable)) throw err;
        console.warn(`   ⚠️ TCGdex otillgänglig för ${set.name} — hoppar källa 1`);
      }
      const ids = tcgdexIdMap(list?.cards ?? []);
      let hit = 0;
      await mapPool(needsCore, CONCURRENCY, async (c) => {
        const dexId = ids.get(normalizeCardNumber(c.number));
        if (!dexId) return;
        let card: TcgdexCardLike | null = null;
        try {
          card = await tcgdexJson<TcgdexCardLike>(`${TCGDEX_BASE}/en/cards/${encodeURIComponent(dexId)}`);
        } catch (err) {
          if (!(err instanceof TcgdexUnavailable)) throw err;
          return;
        }
        if (!card) return;
        const p = factsFromTcgdex(card);
        if (hasAnyFact(p)) {
          patches.set(c.id, p);
          hit++;
        }
      });
      console.log(`[${i + 1}/${sets.length}] ${set.name}: TCGdex ${hit}/${needsCore.length} (${ids.size} i listan)`);
    }

    // 2. pokemontcg.io — bara för det TCGdex inte gav: flavour text (bara
    // Pokémon bär den) och illustratör.
    const stillMissing = cards.filter((c) => {
      const p = patches.get(c.id);
      const flavor = p?.flavorText ?? c.flavorText;
      const artist = p?.artist ?? c.artist;
      return !artist || (!flavor && c.supertype === "Pokémon");
    });
    if (USE_POKEMONTCG && set.externalId && stillMissing.length > 0) {
      try {
        const remote = await fetchTcgCardsForSet(set.externalId, 1000);
        const byNumber = new Map(remote.map((r) => [normalizeCardNumber(r.number), r]));
        let hit = 0;
        for (const c of stillMissing) {
          const r = byNumber.get(normalizeCardNumber(c.number));
          if (!r) continue;
          const p = factsFromPokemontcg(r);
          if (!hasAnyFact(p)) continue;
          const prev = patches.get(c.id);
          // Slå ihop: TCGdex-värden vinner där de finns, pokemontcg.io fyller hålen.
          patches.set(c.id, prev ? mergePatch(prev, p) : p);
          hit++;
        }
        console.log(`   pokemontcg.io: ${hit}/${stillMissing.length}`);
      } catch (err) {
        console.warn(`   ⚠️ pokemontcg.io: ${err instanceof Error ? err.message : err} — hoppar`);
      }
    }

    const n = await writePatches(patches);
    totalWritten += n;
    if (!FLAVOR_ONLY) {
      await prisma.card.updateMany({
        where: { id: { in: cards.map((c) => c.id) } },
        data: { factsCheckedAt: new Date() },
      });
    }
    if (!set.tcgdexId) console.log(`[${i + 1}/${sets.length}] ${set.name}: (inget tcgdexId) skrev ${n}`);
  }
  console.log(`Klart: ${totalWritten} kort uppdaterade, ${skipped} set redan fyllda.`);
}

function mergePatch(a: CardFactsPatch, b: CardFactsPatch): CardFactsPatch {
  return {
    artist: a.artist ?? b.artist,
    hp: a.hp ?? b.hp,
    types: a.types.length > 0 ? a.types : b.types,
    weaknessType: a.weaknessType ?? b.weaknessType,
    weaknessValue: a.weaknessValue ?? b.weaknessValue,
    retreatCost: a.retreatCost ?? b.retreatCost,
    regulationMark: a.regulationMark ?? b.regulationMark,
    dexId: a.dexId ?? b.dexId,
    flavorText: a.flavorText ?? b.flavorText,
  };
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
