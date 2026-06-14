/**
 * Snabb verifiering av datamängder i databasen.
 * Körs med: npx tsx scripts/verify-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [sets, cards, cardsWithImage, retailers, offers, products, productsWithImage, observations, sources] =
    await Promise.all([
      prisma.cardSet.count(),
      prisma.card.count(),
      prisma.card.count({ where: { imageUrl: { not: null } } }),
      prisma.retailer.count(),
      prisma.offer.count(),
      prisma.product.count(),
      prisma.product.count({ where: { imageUrl: { not: null } } }),
      prisma.priceObservation.count(),
      prisma.scrapeSource.count(),
    ]);

  console.log("📊 Datakontroll:");
  console.log(`   Sets:                 ${sets}`);
  console.log(`   Kort:                 ${cards} (med bild: ${cardsWithImage})`);
  console.log(`   Produkter:            ${products} (med bild: ${productsWithImage})`);
  console.log(`   Retailers:            ${retailers}`);
  console.log(`   Offers:               ${offers}`);
  console.log(`   Prisobservationer:    ${observations}`);
  console.log(`   Datakällor:           ${sources}`);

  const retailerList = await prisma.retailer.findMany({ select: { name: true, websiteUrl: true, country: true } });
  console.log("\n🏪 Retailers:");
  for (const r of retailerList) console.log(`   ${r.name} (${r.country}) — ${r.websiteUrl}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
