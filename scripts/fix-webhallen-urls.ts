import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: "Webhallen" }, url: { contains: "/category/" } },
    select: { id: true, product: { select: { title: true } } },
  });
  for (const o of offers) {
    const q = ("Pokemon " + o.product.title).replace(/·/g, " ").replace(/\s+/g, " ").trim();
    await prisma.offer.update({
      where: { id: o.id },
      data: { url: "https://www.webhallen.com/se/search?searchString=" + encodeURIComponent(q) },
    });
  }
  console.log("Fixed: " + offers.length);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
