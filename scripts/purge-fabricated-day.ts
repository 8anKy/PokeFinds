/**
 * Raderar en FABRICERAD dagspunkt ur singel-historiken: en snapshot som ligger
 * minst FACTOR från BÅDE dagen före OCH dagen efter, åt samma håll — dvs en dipp/
 * spik som marknaden aldrig gjorde, utan som en trasig prisregel skrev in.
 *
 * Bakgrund 2026-07-25: singel-golvet publicerades från `lowest_near_mint` utan
 * kontroll mot CM:s egen publicerade lägsta, och från guidens nollställda `trend`.
 * Resultatet blev en katalogbred krasch daterad 2026-07-24 ("N · Noble Victories"
 * 2 426 → 0 kr) som prisfalls-filtret sedan visade som verkliga prisfall. Punkten
 * går inte att "rätta" — den motsvarar ingen observation. Den ska bort.
 *
 * Kravet på BÅDA grannarna är det som skiljer en fabrikation från en äkta
 * nivåförändring: ett riktigt prisfall stannar nere, den här reverterar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-fabricated-day.ts --date=2026-07-24
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-fabricated-day.ts --date=2026-07-24 --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DATE = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1];
const FACTOR = Number(process.argv.find((a) => a.startsWith("--factor="))?.split("=")[1]) || 3;

if (!DATE) {
  console.error("Ange --date=YYYY-MM-DD");
  process.exit(1);
}

const kr = (o: number) => `${(o / 100).toFixed(2)} kr`;

async function main() {
  const db = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`DB: ${db[0].current_database}   dag: ${DATE}   läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}\n`);

  const rows = await prisma.$queryRawUnsafe<
    { productId: string; title: string; slug: string; before: number; day: number; after: number }[]
  >(
    `WITH s AS (
       SELECT ps."productId", ps.date, ps."avgPrice"
       FROM "PriceSnapshot" ps
       JOIN "Product" p ON p.id = ps."productId"
       WHERE p.category = 'SINGLE_CARD'
         AND ps.date BETWEEN $1::date - 7 AND $1::date + 7
         AND ps."avgPrice" > 0
     ),
     d AS (SELECT * FROM s WHERE date = $1::date),
     prev AS (
       SELECT DISTINCT ON ("productId") "productId", "avgPrice"
       FROM s WHERE date < $1::date ORDER BY "productId", date DESC
     ),
     next AS (
       SELECT DISTINCT ON ("productId") "productId", "avgPrice"
       FROM s WHERE date > $1::date ORDER BY "productId", date ASC
     )
     SELECT d."productId", p.title, p.slug,
            prev."avgPrice" AS before, d."avgPrice" AS day, next."avgPrice" AS after
     FROM d
       JOIN prev ON prev."productId" = d."productId"
       JOIN next ON next."productId" = d."productId"
       JOIN "Product" p ON p.id = d."productId"
     WHERE (prev."avgPrice" >= d."avgPrice" * $2::float AND next."avgPrice" >= d."avgPrice" * $2::float)
        OR (d."avgPrice" >= prev."avgPrice" * $2::float AND d."avgPrice" >= next."avgPrice" * $2::float)
     ORDER BY prev."avgPrice"::float / d."avgPrice" DESC`,
    DATE,
    FACTOR
  );

  console.log(`Fabricerade dagspunkter (≥${FACTOR}x från BÅDA grannarna): ${rows.length}\n`);
  for (const r of rows.slice(0, 30)) {
    console.log(`  ${kr(r.before).padStart(12)} → ${kr(r.day).padStart(12)} → ${kr(r.after).padStart(12)}   ${r.title}`);
  }
  if (rows.length > 30) console.log(`  … ${rows.length - 30} till`);

  if (!APPLY || rows.length === 0) {
    if (!APPLY) console.log(`\nTorrkörning — inget raderat. Kör med --apply.`);
    await prisma.$disconnect();
    return;
  }

  const ids = rows.map((r) => r.productId);
  const start = new Date(`${DATE}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 864e5);
  const snaps = await prisma.priceSnapshot.deleteMany({
    where: { productId: { in: ids }, date: { gte: start, lt: end } },
  });
  // Observationerna bakom punkten måste bort också — annars ritar produktgrafen
  // om dippen från PriceObservation (getPriceHistoryBySource läser dem direkt).
  const obs = await prisma.priceObservation.deleteMany({
    where: { productId: { in: ids }, observedAt: { gte: start, lt: end } },
  });
  console.log(`\n✅ ${snaps.count} snapshots och ${obs.count} observationer raderade för ${DATE}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
