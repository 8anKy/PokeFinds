/**
 * Rensar falsk "Cardmarket"-prishistorik för singlar som saknar äkta
 * Cardmarket-data.
 *
 * Bakgrund: importens cardMarketPriceOre föll tillbaka på TCGplayer (USD) när
 * Cardmarket-data saknades och lagrade det som en "Pokémon TCG API"-observation
 * — som hamnar i cardmarket-hinken i grafen. För kort utan CM-mappning (t.ex.
 * Celebrations Classic Collection-reprints) blev grafen en TCGplayer-kurva
 * felmärkt som Cardmarket, trots att vi inte har något CM-pris (och nu ingen
 * CM-offer).
 *
 * Åtgärd: för singlar UTAN Cardmarket-offer, ta bort PriceSnapshots samt
 * "Pokémon TCG API"/"TCGdex API"-observationer som saknar cardmarket-data i
 * rawData (rena TCGplayer-fallbacken). Grafen visar då "Ingen prishistorik ännu".
 *
 * Körs:  npx tsx scripts/clean-unmappable-chart-data.ts          (dry-run)
 *        APPLY=1 npx tsx scripts/clean-unmappable-chart-data.ts  (skriv)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

async function main() {
  const cm = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" }, select: { id: true } });

  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", offers: { none: { retailerId: cm.id } } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  console.log(`Singlar utan CM-offer: ${ids.length}`);
  if (ids.length === 0) return;

  const snapCount = await prisma.priceSnapshot.count({ where: { productId: { in: ids } } });
  const obsRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) n FROM "PriceObservation" po JOIN "ScrapeSource" s ON s.id=po."sourceId"
     WHERE po."productId" = ANY($1::text[]) AND s.name IN ('Pokémon TCG API','TCGdex API')
       AND (po."rawData"->'cardmarket'->'prices') IS NULL`,
    ids
  );
  console.log(`Att radera: ${snapCount} PriceSnapshots, ${Number(obsRows[0].n)} felmärkta CM-observationer.`);

  if (!APPLY) {
    console.log("\nDry-run. Kör med APPLY=1 för att skriva.");
    return;
  }

  const snapDel = await prisma.priceSnapshot.deleteMany({ where: { productId: { in: ids } } });
  const obsDel = await prisma.$executeRawUnsafe(
    `DELETE FROM "PriceObservation" po USING "ScrapeSource" s
     WHERE po."sourceId"=s.id AND po."productId" = ANY($1::text[])
       AND s.name IN ('Pokémon TCG API','TCGdex API')
       AND (po."rawData"->'cardmarket'->'prices') IS NULL`,
    ids
  );
  console.log(`\nKlart: ${snapDel.count} snapshots, ${obsDel} observationer raderade.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
