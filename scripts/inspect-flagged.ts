import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  for (const t of ["Mega Evolution Enhanced 2-Pack Blister Vileplume", "Celebrations 25th Anniversary Elite Trainer Box", "Evolving Skies Pokemon Center Elite Trainer Box", "Phantasmal Flames Booster Box"]) {
    const ps = await prisma.product.findMany({
      where: { title: { contains: t } },
      select: { title: true, offers: { select: { id: true, price: true, url: true, retailer: { select: { name: true } } } } },
    });
    for (const p of ps) {
      console.log(p.title);
      for (const o of p.offers) {
        if (o.price === null) continue;
        console.log("  [" + o.id.slice(0,8) + "] " + o.retailer.name + " " + (o.price/100) + " kr " + (o.url ?? "").slice(0, 90));
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
