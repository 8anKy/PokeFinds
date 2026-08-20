/**
 * Fyller de tre nämnarkolumnerna på CardSet: `totalCardsFull`, `tcgdexId`,
 * `printingsTotal`. Två datakällor, båda gratis och utan nyckel.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-set-denominators.ts --dry
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-set-denominators.ts
 *
 * VARFÖR TVÅ KÄLLOR:
 *  · pokemontcg.io `/sets` ger `total` = hela setet inkl. secret rares (Pitch Black
 *    120, mot `printedTotal` 84). Det är set-kompletteringens nämnare. EN hämtning
 *    för alla 176 engelska set.
 *  · TCGdex (api.tcgdex.net, MIT, ingen nyckel, kommersiellt bruk med attribution)
 *  · TCGdex (api.tcgdex.net, MIT, ingen nyckel, kommersiellt bruk med attribution)
 *    ger per KORT en `variants_detailed`-lista — en post per TRYCKNING. Summan
 *    över setets kort är antalet tryckningar setet innehåller.
 *
 * ⛔ TRYCKNINGARNA RÄKNAS PER KORT, ALDRIG UR SET-NIVÅNS `cardCount`. Mätt
 * 2026-08-20: set-nivåns tal KOLLAPSAR flera tryckningar av samma typ. Base Sets
 * Charizard har FYRA `holo`-poster i `variants_detailed` (1st Edition, Shadowless,
 * Unlimited, …) men bara `holo: true` i `variants`, och set-nivån påstår därför
 * normal=346 på 102 kort medan den sanna summan är 410. För moderna set stämmer de
 * två (Pitch Black 187 = 187, Pokémon GO 145 = 145), för vintage gör de det inte —
 * och ett tal som stämmer ibland är värre än inget. `variants_detailed.length` per
 * kort är det ENDA måttet som är konsekvent i alla eror.
 *
 * ⛔ `printingsTotal` ÄR ALDRIG EN NÄMNARE VI MÄTER ANVÄNDAREN MOT. Master set-raden
 * räknas mot de tryckningar VI listar — ett tal användaren faktiskt kan nå. TCGdex-
 * talet används bara för att säga "setet har 410 tryckningar, vi listar 302 av dem".
 * Därför kan en kvarvarande datalucka hos dem aldrig ge en felaktig PROCENT.
 * 0 = OKÄNT ⇒ noten visas inte alls.
 *
 * ROBOTS: api.tcgdex.net/robots.txt är `Disallow: /` MEN bär en uttrycklig
 * kommentar — "Please note that this is for Crawlers only. You can logically use
 * robots to use the API." API-användning är alltså sanktionerad; det är SIDORNA de
 * stänger ute. Läst 2026-08-20. (Motsatt fall: Playotekets robots.txt såg ut som
 * standard-PrestaShop i toppen och slutade med ett andra `User-agent: *` +
 * `Disallow: /` — läs alltid HELA filen.)
 *
 * ⛔ Pokémon TCG Pocket-set (`serie.id === "tcgp"`) filtreras bort: de delar namn med
 * riktiga set och har inga fysiska tryckningar.
 * ⛔ Bara EN-set. Japanska set kommer ur Cardmarkets expansioner, har inget facit hos
 * någon av källorna och behåller 0 (jp-sets.md: namnuppslag måste språkfiltrera).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { fetchTcgSets } from "../src/scrapers/adapters/pokemontcg-adapter";
import { mapPool } from "../src/lib/concurrency";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const CHUNK = 200;
/** Räkna om tryckningar även för set som redan har ett tal (dyrt: ~20 500 anrop). */
const REFRESH_ALL = process.argv.includes("--refresh-all");
/** Set yngre än så här räknas om varje körning — där tillkommer det fortfarande kort. */
const REFRESH_DAYS = 365;
const DEX_CONCURRENCY = 10;

const DEX_BASE = "https://api.tcgdex.net/v2/en";
const UA = { "User-Agent": "FoilioBot/1.0 (+https://foilio.se)" };

interface DexSet {
  id: string;
  name: string;
  serie?: { id: string };
  cardCount: { total: number; official: number };
  cards?: { id: string }[];
}

interface DexCard {
  id: string;
  /** En post PER TRYCKNING. Längden är kortets bidrag till master set-nämnaren. */
  variants_detailed?: { type: string; size?: string }[];
  variants?: Record<string, boolean>;
}

/** Namnnyckel för matchning: skiljetecken och accenter bort, ett mellanslag kvar. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function dexJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

async function main() {
  const sets = await prisma.cardSet.findMany({
    where: { language: "EN" },
    select: {
      id: true,
      name: true,
      externalId: true,
      releaseDate: true,
      totalCardsFull: true,
      tcgdexId: true,
      printingsTotal: true,
      _count: { select: { cards: true } },
    },
  });
  console.log(`${sets.length} engelska set i katalogen.`);

  // ---------- Källa 1: pokemontcg.io ----------
  const upstream = await fetchTcgSets();
  const totalByExt = new Map(upstream.map((s) => [s.id, s.total]));
  console.log(`pokemontcg.io: ${upstream.length} set.`);

  // ---------- Källa 2: TCGdex ----------
  const list = (await dexJson<{ id: string }[]>(`${DEX_BASE}/sets`)) ?? [];
  const fetched: (DexSet | null)[] = new Array(list.length).fill(null);
  await mapPool(list, 8, async (s, i) => {
    fetched[i] = await dexJson<DexSet>(`${DEX_BASE}/sets/${s.id}`);
  });
  const dexSets = fetched.filter((s): s is DexSet => s != null && s.serie?.id !== "tcgp");
  console.log(`TCGdex: ${list.length} set, ${dexSets.length} fysiska.`);

  const dexByName = new Map<string, DexSet[]>();
  for (const d of dexSets) {
    const k = norm(d.name);
    if (!dexByName.has(k)) dexByName.set(k, []);
    dexByName.get(k)!.push(d);
  }

  const updates: { id: string; full: number; dexId: string | null; printings: number }[] = [];
  const stats = {
    fullFilled: 0,
    fullMissing: 0,
    dexMatched: 0,
    dexUnmatched: 0,
    printingsComputed: 0,
    printingsReused: 0,
    printingsFailed: 0,
    dexCardRequests: 0,
  };
  const unmatched: string[] = [];
  const failures: string[] = [];

  const freshCutoff = Date.now() - REFRESH_DAYS * 24 * 60 * 60 * 1000;

  for (const s of sets) {
    const full = (s.externalId ? totalByExt.get(s.externalId) : undefined) ?? 0;
    if (full > 0) stats.fullFilled++;
    else stats.fullMissing++;

    // Namnkrockar löses på KORTANTAL, aldrig på gissning.
    const cands = dexByName.get(norm(s.name)) ?? [];
    const dex =
      cands.find((c) => c.cardCount.total === s._count.cards) ??
      (cands.length === 1 ? cands[0] : undefined);
    if (!dex) {
      stats.dexUnmatched++;
      unmatched.push(`${s.name} (kort=${s._count.cards}, kandidater=${cands.length})`);
      updates.push({ id: s.id, full, dexId: null, printings: 0 });
      continue;
    }
    stats.dexMatched++;

    // Räkna bara om när vi MÅSTE: det kostar ett HTTP-anrop per kort. Set yngre än
    // ett år räknas om varje körning — där tillkommer det fortfarande kort.
    const isFresh = s.releaseDate != null && s.releaseDate.getTime() >= freshCutoff;
    if (!(REFRESH_ALL || s.printingsTotal === 0 || isFresh)) {
      stats.printingsReused++;
      updates.push({ id: s.id, full, dexId: dex.id, printings: s.printingsTotal });
      continue;
    }

    const detail = await dexJson<DexSet>(`${DEX_BASE}/sets/${dex.id}`);
    const ids = detail?.cards?.map((c) => c.id) ?? [];
    if (ids.length === 0) {
      stats.printingsFailed++;
      failures.push(`${s.name} [${dex.id}]: TCGdex gav ingen kortlista`);
      updates.push({ id: s.id, full, dexId: dex.id, printings: 0 });
      continue;
    }

    let printings = 0;
    let missing = 0;
    await mapPool(ids, DEX_CONCURRENCY, async (cardId) => {
      const c = await dexJson<DexCard>(`${DEX_BASE}/cards/${cardId}`);
      stats.dexCardRequests++;
      const n = c?.variants_detailed?.length ?? 0;
      if (n === 0) missing++;
      printings += n;
    });

    // ⛔ ALLT ELLER INGET. Ett delvis svar (nätverksfel mitt i, kort utan
    // variantdata) ger ett för LÅGT tal som ser exakt lika trovärdigt ut som ett
    // rätt. 0 = OKÄNT och noten uteblir — det är det ärliga utfallet.
    if (missing > 0) {
      stats.printingsFailed++;
      failures.push(`${s.name} [${dex.id}]: ${missing} av ${ids.length} kort saknade variantdata`);
      updates.push({ id: s.id, full, dexId: dex.id, printings: 0 });
      continue;
    }
    stats.printingsComputed++;
    updates.push({ id: s.id, full, dexId: dex.id, printings });
    console.log(`  ${s.name} [${dex.id}]: ${ids.length} kort → ${printings} tryckningar`);
  }


  console.log("\n=== SAMMANFATTNING ===");
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\n=== TCGDEX OMATCHADE (${unmatched.length}) ===`);
  for (const u of unmatched) console.log("  " + u);
  console.log(`
=== TRYCKNINGAR KUNDE INTE RÄKNAS — lämnas 0 (${failures.length}) ===`);
  for (const f of failures.slice(0, 40)) console.log("  " + f);
  if (failures.length > 40) console.log(`  … och ${failures.length - 40} till`);

  const changed = updates.filter((u) => {
    const s = sets.find((x) => x.id === u.id)!;
    return s.totalCardsFull !== u.full || s.tcgdexId !== u.dexId || s.printingsTotal !== u.printings;
  });
  console.log(`\n${changed.length} set får nya värden.`);

  if (DRY) {
    console.log("TORRKÖRNING — inget skrevs.");
    return;
  }

  let written = 0;
  for (let i = 0; i < changed.length; i += CHUNK) {
    const chunk = changed.slice(i, i + CHUNK);
    // En sats per ~200 rader — Neons nota är vaken tid, inte rader.
    written += await prisma.$executeRaw`
      UPDATE "CardSet" AS s
         SET "totalCardsFull" = v.total_full::int,
             "tcgdexId"       = v.dex_id,
             "printingsTotal" = v.printings::int
        FROM (VALUES ${Prisma.join(
          chunk.map((u) => Prisma.sql`(${u.id}, ${u.full}, ${u.dexId}, ${u.printings})`)
        )}) AS v(set_id, total_full, dex_id, printings)
       WHERE s.id = v.set_id`;
  }
  console.log(`${written} rader skrivna.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
