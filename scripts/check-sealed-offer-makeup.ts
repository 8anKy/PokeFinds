import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT r.name,
      COUNT(*) FILTER (WHERE o.url LIKE '%/search%' OR o.url LIKE '%searchString%' OR o.url LIKE '%funk=sok%' OR o.url LIKE '%query=%' OR o.url LIKE '%keywords=%' OR o.url LIKE '%/s/?q=%') AS search_urls,
      COUNT(*) FILTER (WHERE NOT (o.url LIKE '%/search%' OR o.url LIKE '%searchString%' OR o.url LIKE '%funk=sok%' OR o.url LIKE '%query=%' OR o.url LIKE '%keywords=%' OR o.url LIKE '%/s/?q=%')) AS product_urls,
      COUNT(*) AS total
    FROM "Offer" o JOIN "Retailer" r ON r.id=o."retailerId" JOIN "Product" p ON p.id=o."productId"
    WHERE p.category NOT IN ('SINGLE_CARD','GRADED_CARD')
    GROUP BY r.name ORDER BY total DESC`);
  for (const r of rows) console.log(r.name + ": total=" + r.total + " productUrl=" + r.product_urls + " searchUrl=" + r.search_urls);
  const sealedProds = await prisma.product.count({ where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } });
  console.log("Sealed/other products: " + sealedProds);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
