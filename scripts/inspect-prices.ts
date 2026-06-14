import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Sample a well-known card and check its offers
  const prod = await prisma.product.findFirst({
    where: { normalizedTitle: { contains: "team rocket s mewtwo ex ascended heroes" } },
    include: { offers: { include: { retailer: { select: { name: true } } } } },
  });
  console.log("Product:", prod?.title);
  for (const o of prod?.offers ?? []) {
    if (o.price === null) continue;
    console.log(`  ${o.retailer.name}: ${(o.price/100).toFixed(0)} kr | ship ${(o.shippingPrice??0)/100} kr | ${o.stockStatus} | ${o.url.slice(0,90)}`);
  }

  // Another: a popular single card
  const prod2 = await prisma.product.findFirst({
    where: { normalizedTitle: { contains: "charizard" }, category: "SINGLE_CARD" },
    include: { offers: { include: { retailer: { select: { name: true } } } } },
  });
  console.log("\nProduct:", prod2?.title);
  for (const o of prod2?.offers ?? []) {
    if (o.price === null) continue;
    console.log(`  ${o.retailer.name}: ${(o.price/100).toFixed(0)} kr | ${o.url.slice(0,90)}`);
  }

  // Offer URL distribution
  const traderaSearch = await prisma.offer.count({ where: { url: { contains: "tradera.com/search" } } });
  const traderaItem = await prisma.offer.count({ where: { url: { contains: "tradera.com/item" } } });
  const cardmarketSearch = await prisma.offer.count({ where: { url: { contains: "cardmarket.com" } } });
  console.log("\nTradera search URLs:", traderaSearch, "| Tradera item URLs:", traderaItem);
  console.log("Cardmarket URLs:", cardmarketSearch);
  const cmSample = await prisma.offer.findFirst({ where: { url: { contains: "cardmarket.com" } }, select: { url: true, price: true } });
  console.log("Cardmarket sample:", cmSample?.url.slice(0,110), (cmSample?.price??0)/100, "kr");
}
main().catch(console.error).finally(() => prisma.$disconnect());
