import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const dupes: any[] = await prisma.$queryRawUnsafe(`
    SELECT o."productId", r.name, COUNT(*) c
    FROM "Offer" o JOIN "Retailer" r ON r.id = o."retailerId"
    WHERE r.name NOT IN ('Cardmarket','Tradera')
    GROUP BY o."productId", r.name HAVING COUNT(*) > 1 LIMIT 20`);
  console.log("Product+retailer combos with >1 offer: " + dupes.length);
  for (const d of dupes) {
    const offers = await prisma.offer.findMany({
      where: { productId: d.productId, retailer: { name: d.name } },
      select: { id: true, price: true, condition: true, language: true, url: true, updatedAt: true },
    });
    const p = await prisma.product.findUnique({ where: { id: d.productId }, select: { title: true } });
    console.log('"' + p?.title + '" @ ' + d.name);
    for (const o of offers) {
      if (o.price === null) continue;
      console.log("   " + (o.price/100) + " kr " + o.condition + "/" + o.language + " " + o.url?.slice(0, 70) + " (upd " + o.updatedAt.toISOString().slice(0,10) + ")");
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
