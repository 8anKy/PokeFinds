/**
 * 1. Improve Tradera search URLs for single cards: use full card fraction
 *    ("4/165") from the title for more precise search results.
 * 2. Create today's PriceSnapshot for every product with offers so the
 *    price history chart has real data (accumulates daily going forward).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = 50;

async function main() {
  // ============ 1. PRECISE TRADERA URLS ============
  console.log("1. Improving Tradera search URLs for single cards...");
  const tradera = await prisma.retailer.findUnique({ where: { name: "Tradera" } });
  if (!tradera) throw new Error("Tradera retailer missing");

  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", offers: { some: { retailerId: tradera.id } } },
    select: {
      id: true,
      title: true,
      card: { select: { name: true } },
      set: { select: { name: true } },
    },
  });
  console.log("   Products: " + products.length);

  let urlsUpdated = 0;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (p) => {
        const cardName = p.card?.name ?? p.title.split("·")[0].trim();
        const setName = p.set?.name ?? "";
        // Extract fraction like "4/165" from title
        const fraction = p.title.match(/(\d+[a-zA-Z]*\/\d+)/)?.[1] ?? "";
        const query = ["Pokemon", cardName, setName, fraction].filter(Boolean).join(" ");
        const url = "https://www.tradera.com/search?q=" + encodeURIComponent(query);
        await prisma.offer.updateMany({
          where: { productId: p.id, retailerId: tradera.id },
          data: { url },
        });
        urlsUpdated++;
      })
    );
  }
  console.log("   Updated " + urlsUpdated + " Tradera URLs\n");

  // ============ 2. TODAY'S PRICE SNAPSHOTS ============
  console.log("2. Creating today's price snapshots from current offers...");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withOffers = await prisma.product.findMany({
    where: { offers: { some: {} } },
    select: { id: true, offers: { select: { price: true } } },
  });
  console.log("   Products with offers: " + withOffers.length);

  let snapsCreated = 0;
  for (let i = 0; i < withOffers.length; i += BATCH) {
    const batch = withOffers.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (p) => {
        const prices = p.offers.map((o) => o.price).filter((x): x is number => x !== null);
        if (prices.length === 0) return;
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        await prisma.priceSnapshot.upsert({
          where: { productId_date: { productId: p.id, date: today } },
          update: { minPrice: min, maxPrice: max, avgPrice: avg, volume: prices.length },
          create: {
            productId: p.id,
            date: today,
            minPrice: min,
            maxPrice: max,
            avgPrice: avg,
            volume: prices.length,
          },
        });
        snapsCreated++;
      })
    );
    if ((i / BATCH) % 50 === 0) console.log("   ..." + Math.min(i + BATCH, withOffers.length) + "/" + withOffers.length);
  }
  console.log("   Snapshots: " + snapsCreated);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
