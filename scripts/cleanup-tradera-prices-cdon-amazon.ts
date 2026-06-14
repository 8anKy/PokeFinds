/**
 * Datarensning 2026-06-12:
 *
 * 1. Tradera-offers som pekar på SÖKRESULTAT (inte /item/) men ändå har pris +
 *    IN_STOCK är fabricerade — nollas till länk-offers (price=null, UNKNOWN).
 *    Riktiga skrapade listningar (/item/-URL:er) behålls orörda.
 * 2. Cardmarket-offers: fabricerad fraktkostnad (45 kr schablon) nollas —
 *    frakt varierar per säljare och ska visas som okänd.
 * 3. CDON + Amazon.se tas bort helt (Retailer + ScrapeSource) — inga offers
 *    finns, ingen adapter är tillåten enligt deras villkor.
 * 4. GRADED_CARD-artefaktprodukter ("tradera-sald"-poster, PSA-graderade) tas
 *    bort — plattformen visar raw-priser (ogradera) för singelkort.
 *
 * Körs med: npx tsx scripts/cleanup-tradera-prices-cdon-amazon.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Fabricerade Tradera-priser på söklänkar
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  const fixedTradera = await prisma.offer.updateMany({
    where: {
      retailerId: tradera.id,
      price: { not: null },
      NOT: { url: { contains: "/item/" } },
    },
    data: { price: null, stockStatus: "UNKNOWN", shippingPrice: null },
  });
  console.log(`Tradera-söklänkar avprissatta: ${fixedTradera.count}`);

  // 2. Fabricerad frakt på Cardmarket-offers
  const cardmarket = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });
  const fixedShipping = await prisma.offer.updateMany({
    where: { retailerId: cardmarket.id, shippingPrice: { not: null } },
    data: { shippingPrice: null },
  });
  console.log(`Cardmarket-frakt nollad: ${fixedShipping.count}`);

  // 3. CDON + Amazon.se bort
  for (const name of ["CDON", "Amazon.se"]) {
    const retailer = await prisma.retailer.findFirst({ where: { name } });
    if (retailer) {
      const offers = await prisma.offer.count({ where: { retailerId: retailer.id } });
      const restocks = await prisma.restockEvent.count({ where: { retailerId: retailer.id } });
      if (offers > 0 || restocks > 0) {
        await prisma.offer.deleteMany({ where: { retailerId: retailer.id } });
        await prisma.restockEvent.deleteMany({ where: { retailerId: retailer.id } });
        console.log(`${name}: raderade ${offers} offers, ${restocks} restock-händelser`);
      }
      await prisma.retailer.delete({ where: { id: retailer.id } });
      console.log(`Retailer borttagen: ${name}`);
    }
    const source = await prisma.scrapeSource.findFirst({ where: { name } });
    if (source) {
      await prisma.scrapeSource.delete({ where: { id: source.id } });
      console.log(`ScrapeSource borttagen: ${name}`);
    }
  }

  // 4. Graderade artefaktprodukter (raw-principen)
  const graded = await prisma.product.findMany({
    where: { category: "GRADED_CARD" },
    select: { id: true, title: true },
  });
  for (const p of graded) {
    await prisma.product.delete({ where: { id: p.id } });
    console.log(`Graderad artefaktprodukt borttagen: ${p.title}`);
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
