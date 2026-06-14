import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { in: ["Spelexperten", "Webhallen", "Alphaspel", "Dragon's Lair"] } } },
    select: {
      id: true, url: true,
      retailer: { select: { name: true } },
      product: { select: { title: true } },
    },
    orderBy: [{ retailerId: "asc" }],
  });
  console.log("Total retail offers:", offers.length);
  // Count how many have category-page URLs (no specific product path)
  let bad = 0;
  for (const o of offers) {
    const isCategory = /\/(kategorier|category|sallskapsspel)\//.test(o.url) || o.url.endsWith("/pokemon/") || o.url.includes("18954-Pokemon");
    if (isCategory) bad++;
  }
  console.log("Category-page URLs:", bad);
  for (const o of offers) {
    console.log(`${o.retailer.name} | ${o.product.title.slice(0, 55)} | ${o.url.slice(0, 70)}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
