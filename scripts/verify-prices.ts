import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  for (const q of ["charmander 151 4/165", "charizard ex 151 6/165", "pikachu 151 25/165"]) {
    const prod = await prisma.product.findFirst({
      where: { normalizedTitle: { contains: q } },
      include: { offers: { include: { retailer: { select: { name: true } } } } },
    });
    if (!prod) { console.log("Not found:", q); continue; }
    console.log(prod.title);
    for (const o of prod.offers) {
      if (o.price === null) continue;
      console.log(`  ${o.retailer.name}: ${(o.price/100).toFixed(2)} kr + ${(o.shippingPrice??0)/100} frakt | ${o.stockStatus}`);
      console.log(`    ${o.url.slice(0, 100)}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
