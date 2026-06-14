/**
 * For sealed products with both a NEAR_MINT (scraped) and SEALED (older) offer
 * from the same retailer: move the scraped price/URL/stock into the SEALED
 * offer and delete the NEAR_MINT dupe. Guard: if the scraped price deviates
 * >60% from the SEALED price AND from the product's other offers' median,
 * treat it as a bad fuzzy match and delete the scraped offer instead.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const dupes: { productId: string; retailerId: string }[] = await prisma.$queryRawUnsafe(`
    SELECT o."productId", o."retailerId"
    FROM "Offer" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE p.category NOT IN ('SINGLE_CARD','GRADED_CARD')
    GROUP BY o."productId", o."retailerId" HAVING COUNT(*) > 1`);
  console.log("Dupe groups: " + dupes.length);

  let merged = 0, badMatch = 0;
  for (const d of dupes) {
    const offers = await prisma.offer.findMany({
      where: { productId: d.productId, retailerId: d.retailerId },
      orderBy: { updatedAt: "desc" },
    });
    const scraped = offers.find(o => o.condition === "NEAR_MINT");
    const sealed = offers.find(o => o.condition === "SEALED");
    if (!scraped || !sealed) continue;
    if (scraped.price === null) continue;

    const p = await prisma.product.findUnique({
      where: { id: d.productId },
      select: { title: true, offers: { where: { id: { notIn: [scraped.id] } }, select: { price: true } } },
    });
    const others = p!.offers.map(o => o.price).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)];
    const dev = Math.abs(scraped.price - median) / median;

    if (dev > 0.6) {
      await prisma.offer.delete({ where: { id: scraped.id } });
      badMatch++;
      console.log("BAD MATCH removed: \"" + p!.title + "\" scraped " + (scraped.price/100) + " kr vs median " + (median/100) + " kr");
    } else {
      await prisma.offer.update({
        where: { id: sealed.id },
        data: { price: scraped.price, url: scraped.url, stockStatus: scraped.stockStatus, lastSeenAt: new Date() },
      });
      await prisma.offer.delete({ where: { id: scraped.id } });
      merged++;
    }
  }
  console.log("Merged: " + merged + ", bad matches removed: " + badMatch);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
