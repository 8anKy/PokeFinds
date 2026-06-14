/**
 * Single-pass outlier filter for sealed offers (no cascade):
 * 1. Category price bands for clear-cut categories (booster pack/box):
 *    offers outside the band are mismatches or lot/case listings.
 * 2. For other categories with >=3 offers: remove offers >70% from the
 *    overall median (computed once on a snapshot of the offers).
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Bands in öre
const BANDS: Record<string, [number, number]> = {
  BOOSTER_PACK: [3000, 16000], // 30–160 kr
  BOOSTER_BOX: [120000, 800000], // 1200–8000 kr
};

async function main() {
  const prods = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, offers: { some: {} } },
    select: {
      title: true,
      category: true,
      offers: { select: { id: true, price: true, retailer: { select: { name: true } } } },
    },
  });
  const toDelete: { id: string; why: string }[] = [];
  for (const p of prods) {
    const band = BANDS[p.category];
    if (band) {
      for (const o of p.offers) {
        if (o.price === null) continue;
        if (o.price < band[0] || o.price > band[1]) {
          toDelete.push({
            id: o.id,
            why: '"' + p.title + '" ' + o.retailer.name + " " + o.price / 100 + " kr (band " + band[0] / 100 + "-" + band[1] / 100 + ")",
          });
        }
      }
    } else {
      const prices = p.offers.map((o) => o.price).filter((x): x is number => x !== null).sort((a, b) => a - b);
      if (prices.length < 3) continue;
      const median = prices[Math.floor(prices.length / 2)];
      for (const o of p.offers) {
        if (o.price === null) continue;
        if (Math.abs(o.price - median) / median > 0.7) {
          toDelete.push({
            id: o.id,
            why: '"' + p.title + '" ' + o.retailer.name + " " + o.price / 100 + " kr (median " + median / 100 + ")",
          });
        }
      }
    }
  }
  for (const d of toDelete) {
    await prisma.offer.delete({ where: { id: d.id } });
    console.log("REMOVED " + d.why);
  }
  console.log("Removed: " + toDelete.length);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
