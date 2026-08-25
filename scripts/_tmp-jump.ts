import { prisma } from "../src/lib/db";
async function main() {
  const rows = await prisma.$queryRaw<{ d: Date; n: bigint; med: number }[]>`
    WITH s AS (
      SELECT "productId", "date", "minPrice",
             LAG("minPrice") OVER (PARTITION BY "productId" ORDER BY "date") AS prev
      FROM "PriceSnapshot" WHERE "date" > CURRENT_DATE - 10
    )
    SELECT "date" AS d, COUNT(*)::bigint AS n,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "minPrice"::float / NULLIF(prev,0)) AS med
    FROM s WHERE prev IS NOT NULL AND prev > 0 AND "minPrice"::float / prev >= 5
    GROUP BY 1 ORDER BY 1 DESC`;
  console.log("Produkter vars dagspris HOPPADE >=5x mot föregående dag:");
  for (const r of rows) console.log(`  ${r.d.toISOString().slice(0,10)}  ${r.n} produkter  (median-faktor ${Number(r.med).toFixed(1)}x)`);
}
main().finally(() => prisma.$disconnect());
