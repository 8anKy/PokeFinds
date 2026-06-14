import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function main() {
  const prods = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", offers: { some: {} } },
    select: {
      id: true, title: true,
      card: { select: { name: true } },
      offers: { select: { id: true, url: true, retailer: { select: { name: true } } } },
    },
  });
  let bad = 0;
  const badProds: string[] = [];
  for (const p of prods) {
    const cardName = (p.card?.name ?? p.title.split("·")[0]).trim();
    const key = norm(cardName.split(" ")[0]);
    if (key.length < 3) continue;
    for (const o of p.offers) {
      if (!o.url) continue;
      if (!norm(decodeURIComponent(o.url)).includes(key)) {
        bad++;
        badProds.push(p.id + ' "' + p.title + '" ' + o.retailer.name + " -> " + decodeURIComponent(o.url).slice(60, 120));
        break;
      }
    }
  }
  console.log("Mismatched: " + bad);
  badProds.slice(0, 30).forEach(s => console.log("  " + s));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
