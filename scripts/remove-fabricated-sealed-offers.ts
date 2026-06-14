/**
 * Sealed products: Cardmarket offers were seeded with fabricated prices
 * (no real CM data exists for sealed) and Tradera offers with /search URLs
 * were likewise fabricated. Remove them; keep real scraped Tradera item
 * listings and real retail store offers.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const cm = await prisma.offer.deleteMany({
    where: {
      retailer: { name: "Cardmarket" },
      product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    },
  });
  const tr = await prisma.offer.deleteMany({
    where: {
      retailer: { name: "Tradera" },
      product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
      url: { contains: "/search" },
    },
  });
  console.log("Deleted fabricated: Cardmarket=" + cm.count + ", Tradera=" + tr.count);
  const noOffers = await prisma.product.count({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, offers: { none: {} } },
  });
  const withOffers = await prisma.product.count({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, offers: { some: {} } },
  });
  console.log("Sealed with offers: " + withOffers + ", without: " + noOffers);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
