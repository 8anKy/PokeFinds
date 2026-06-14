import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const FIX: Record<string, (q: string) => string> = {
  "Dragon's Lair": q => "https://www.dragonslair.se/advanced_search_result.php?keywords=" + encodeURIComponent(q),
  "Spelbutiken": q => "https://www.spelbutiken.se/s/?q=" + encodeURIComponent(q),
  "CDON": q => "https://cdon.se/s/?q=" + encodeURIComponent(q),
};
async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { in: Object.keys(FIX) } }, url: { contains: "search" } },
    select: { id: true, url: true, retailer: { select: { name: true } }, product: { select: { title: true } } },
  });
  let n = 0;
  for (const o of offers) {
    const q = ("Pokemon " + o.product.title).replace(/·/g, " ").replace(/\s+/g, " ").trim();
    await prisma.offer.update({ where: { id: o.id }, data: { url: FIX[o.retailer.name](q) } });
    n++;
  }
  console.log("Fixed: " + n);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
