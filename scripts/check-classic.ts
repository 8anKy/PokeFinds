import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const prods = await prisma.product.findMany({
    where: { title: { contains: "Classic" } },
    select: { id: true, title: true, offers: { select: { price: true, url: true, retailer: { select: { name: true } } } } },
  });
  for (const p of prods) {
    console.log(p.title);
    for (const o of p.offers) {
      if (o.price === null) continue;
      console.log("  " + o.retailer.name + " " + (o.price/100) + " kr " + (o.url ?? "").slice(0, 80));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
