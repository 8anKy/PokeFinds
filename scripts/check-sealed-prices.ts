import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const prods = await prisma.product.findMany({
    where: { category: { in: ["ETB", "BOOSTER_BOX"] }, offers: { some: {} } },
    include: { offers: { include: { retailer: { select: { name: true } } } } },
    take: 6,
  });
  for (const p of prods) {
    console.log(p.title.slice(0, 60));
    for (const o of p.offers) {
      if (o.price === null) continue;
      console.log(`  ${o.retailer.name}: ${(o.price/100).toFixed(0)} kr | ${o.url.slice(0, 80)}`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
