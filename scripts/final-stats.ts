import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT r.name, COUNT(*) total,
      COUNT(*) FILTER (WHERE o.url LIKE '%/item/%' OR o.url LIKE '%/product/%' OR o.url LIKE '%.html%' OR (o.url LIKE '%dragonslair.se%' AND o.url NOT LIKE '%keywords=%') OR o.url LIKE '%alphaspel.se/17%') AS exact_urls
    FROM "Offer" o JOIN "Retailer" r ON r.id=o."retailerId" GROUP BY r.name ORDER BY total DESC`);
  for (const r of rows) console.log(r.name + ": " + r.total + " offers (" + r.exact_urls + " exakta produkt-URL:er)");
  console.log("Sealed med offers: " + await prisma.product.count({ where: { category: { notIn: ["SINGLE_CARD","GRADED_CARD"] }, offers: { some: {} } } }));
  console.log("Sealed utan offers: " + await prisma.product.count({ where: { category: { notIn: ["SINGLE_CARD","GRADED_CARD"] }, offers: { none: {} } } }));
  console.log("Singlar med offers: " + await prisma.product.count({ where: { category: "SINGLE_CARD", offers: { some: {} } } }));
  console.log("Singlar utan offers: " + await prisma.product.count({ where: { category: "SINGLE_CARD", offers: { none: {} } } }));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
