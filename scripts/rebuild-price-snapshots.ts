/**
 * Bygger om ALLA PriceSnapshots från Cardmarket-källornas prisobservationer.
 *
 * Bakgrund: snapshots aggregerade tidigare observationer från alla källor
 * (butiker, Tradera, Cardmarket) i samma dagssnitt. När källsammansättningen
 * skiftade mellan dagar uppstod enorma fejkade prisförändringar
 * (+2 296 747 % på landningssidan). PriceSnapshot = marknadspris = endast
 * Cardmarket-data, samma serie som produktsidans graf.
 *
 * Idempotent: raderar allt och bygger om från PriceObservation.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CARDMARKET_SOURCE_NAMES = ["Cardmarket", "Pokémon TCG API", "TCGdex API"];

interface Row {
  productId: string;
  day: Date;
  min: number;
  max: number;
  avg: number;
  n: bigint;
}

async function main() {
  const deleted = await prisma.priceSnapshot.deleteMany({});
  console.log(`Raderade ${deleted.count} gamla snapshots (alla källor blandade).`);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT o."productId",
           date_trunc('day', o."observedAt") AS day,
           MIN(o.price)::int AS min,
           MAX(o.price)::int AS max,
           ROUND(AVG(o.price))::int AS avg,
           COUNT(*) AS n
    FROM "PriceObservation" o
    JOIN "ScrapeSource" s ON s.id = o."sourceId"
    WHERE s.name = ANY(${CARDMARKET_SOURCE_NAMES})
    GROUP BY o."productId", date_trunc('day', o."observedAt")
  `;
  console.log(`${rows.length} dag/produkt-grupper från Cardmarket-observationer.`);

  const data = rows.map((r) => ({
    productId: r.productId,
    date: r.day,
    minPrice: r.min,
    maxPrice: r.max,
    avgPrice: r.avg,
    volume: Number(r.n),
  }));

  let created = 0;
  for (let i = 0; i < data.length; i += 2000) {
    const res = await prisma.priceSnapshot.createMany({
      data: data.slice(i, i + 2000),
      skipDuplicates: true,
    });
    created += res.count;
  }
  console.log(`Skapade ${created} snapshots (endast Cardmarket-marknadspris).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
