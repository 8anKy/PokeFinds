/**
 * HP-BACKFILL — fyller `Card.hp` från pokemontcg.io för hela katalogen.
 *
 * VARFÖR (2026-07-30): HP är skannerns särskiljare när samlarnumret inte går
 * att läsa (numret är ~3 px på ett skärmfoto; HP är kortets största tal).
 * Mätt på fallet som drev fram kolumnen: 28 kort heter exakt "Gyarados", men
 * HP 90 bär bara 3 av dem — och "nyast först" bland de tre är exakt rätt kort.
 *
 * Körs EN gång efter migrationen; framtida set får hp via import-tcg-data.ts
 * (samma parseTcgHp). Resumerbar: set vars kort redan har hp hoppas över med
 * SKIP_FILLED=1 (default PÅ) — kör om med SKIP_FILLED=0 för att tvinga allt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-card-hp.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  fetchTcgCardsForSet,
  parseTcgHp,
} from "../src/scrapers/adapters/pokemontcg-adapter";

const prisma = new PrismaClient();
const SKIP_FILLED = process.env.SKIP_FILLED !== "0";
/** Kort per set — långt över största setet (Chaos Rising ~500). */
const MAX_CARDS = 1000;
const CHUNK = 500;

async function main() {
  const sets = await prisma.cardSet.findMany({
    where: { externalId: { not: null } },
    select: {
      id: true,
      name: true,
      externalId: true,
      _count: { select: { cards: true } },
    },
    orderBy: { releaseDate: "desc" },
  });
  console.log(`${sets.length} set med externalId`);

  let updated = 0;
  let skippedSets = 0;
  for (const [i, set] of sets.entries()) {
    if (SKIP_FILLED) {
      const missing = await prisma.card.count({
        where: { setId: set.id, hp: null, supertype: "Pokémon" },
      });
      if (missing === 0) {
        skippedSets++;
        continue;
      }
    }
    let cards;
    try {
      cards = await fetchTcgCardsForSet(set.externalId!, MAX_CARDS);
    } catch (err) {
      console.warn(
        `   ⚠️ ${set.name}: ${err instanceof Error ? err.message : err} — hoppar över`
      );
      continue;
    }
    const values = cards.flatMap((c) => {
      const hp = parseTcgHp(c.hp);
      return hp != null ? [{ tcgid: c.id, hp }] : [];
    });
    // Chunkad mängd-UPDATE: en sats per 500 rader i stället för en per kort —
    // hela backfillen blir ~40 satser mot Neon, inte ~20 000.
    for (let o = 0; o < values.length; o += CHUNK) {
      const chunk = values.slice(o, o + CHUNK);
      const rows = Prisma.join(
        chunk.map((v) => Prisma.sql`(${v.tcgid}, ${v.hp})`)
      );
      const n = await prisma.$executeRaw`
        UPDATE "Card" AS c SET "hp" = v.hp::int
        FROM (VALUES ${rows}) AS v(tcgid, hp)
        WHERE c."tcgExternalId" = v.tcgid AND c."hp" IS DISTINCT FROM v.hp::int`;
      updated += n;
    }
    console.log(
      `[${i + 1}/${sets.length}] ${set.name}: ${values.length} kort med HP`
    );
  }

  const withHp = await prisma.card.count({ where: { hp: { not: null } } });
  console.log(
    `\nKlart: ${updated} rader uppdaterade · ${skippedSets} set redan fyllda · totalt ${withHp} kort med HP`
  );
}

main().finally(() => prisma.$disconnect());
