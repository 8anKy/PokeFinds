import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Sealed products where one offer deviates >70% from the median of its offers
  const prods = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] }, offers: { some: {} } },
    select: { title: true, offers: { select: { price: true, retailer: { select: { name: true } }, url: true } } },
  });
  let flagged = 0;
  for (const p of prods) {
    const prices = p.offers.map(o => o.price).filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (prices.length < 2) continue;
    const median = prices[Math.floor(prices.length / 2)];
    for (const o of p.offers) {
      if (o.price === null) continue;
      if (Math.abs(o.price - median) / median > 0.7) {
        flagged++;
        console.log('"' + p.title + '": ' + o.retailer.name + " " + (o.price/100) + " kr (median " + (median/100) + ") " + (o.url ?? "").slice(0, 70));
      }
    }
  }
  console.log("Flagged outlier offers: " + flagged);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
