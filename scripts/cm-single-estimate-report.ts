/**
 * MÄTNING: hur många singel-CM-offers är prissatta av en UPPSKATTNING (From saknades)
 * istället för ett riktigt golv, och hur skadligt är det uppskattade värdet?
 *
 * `from=false` markeras i data som CM-offer med stockStatus=OUT_OF_STOCK på en
 * SINGLE_CARD (se cardmarket-refresh.ts). Uppskattningen kommer från CM:s prisguide
 * (`trend`), som på tunt handlad vintage innehåller nollställda värden (0,02 €) och
 * trender som ligger 10x under sitt eget 30-dagarssnitt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/cm-single-estimate-report.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const [summary] = await prisma.$queryRawUnsafe<
    { total: bigint; estimate: bigint; real: bigint; under55: bigint; under300: bigint }[]
  >(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE o."stockStatus" = 'OUT_OF_STOCK')                     AS estimate,
            COUNT(*) FILTER (WHERE o."stockStatus" = 'IN_STOCK')                         AS real,
            COUNT(*) FILTER (WHERE o.price < 55)                                         AS under55,
            COUNT(*) FILTER (WHERE o.price < 300)                                        AS under300
     FROM "Offer" o JOIN "Product" p ON p.id = o."productId"
     WHERE o."retailerId" = $1 AND p.category = 'SINGLE_CARD' AND o.price IS NOT NULL`,
    cm.id
  );
  console.log("=== CM-offers på singlar ===");
  console.log(`  totalt prissatta : ${summary.total}`);
  console.log(`  riktigt From     : ${summary.real}   (IN_STOCK)`);
  console.log(`  UPPSKATTNING     : ${summary.estimate}   (OUT_OF_STOCK — From saknades)`);
  console.log(`  under 0,55 kr    : ${summary.under55}   ⟵ 0,02 €-klassen (korrupt guide-trend)`);
  console.log(`  under 3 kr       : ${summary.under300}`);

  // De uppskattade som dessutom ligger absurt lågt mot produktens EGEN historik
  // före policybytet (senaste snapshot äldre än 2026-07-24).
  const bad = await prisma.$queryRawUnsafe<
    { title: string; slug: string; price: number; priorAvg: number; ratio: number; stock: string; url: string }[]
  >(
    `WITH prior AS (
       SELECT "productId", AVG("avgPrice") AS avg_before
       FROM "PriceSnapshot"
       WHERE date >= date '2026-07-17' AND date < date '2026-07-24'
       GROUP BY "productId"
     )
     SELECT p.title, p.slug, o.price, ROUND(prior.avg_before)::int AS "priorAvg",
            (prior.avg_before / NULLIF(o.price,0))::float AS ratio,
            o."stockStatus"::text AS stock, o.url
     FROM "Offer" o
       JOIN "Product" p ON p.id = o."productId"
       JOIN prior ON prior."productId" = o."productId"
     WHERE o."retailerId" = $1 AND p.category = 'SINGLE_CARD'
       AND o.price IS NOT NULL AND o.price > 0
       AND prior.avg_before > o.price * 5
     ORDER BY ratio DESC`,
    cm.id
  );

  console.log(`\n=== Singlar vars CM-pris föll ≥5x mot sitt eget 07-17…07-23-snitt — ${bad.length} st ===`);
  const est = bad.filter((b) => b.stock === "OUT_OF_STOCK");
  console.log(`  varav UPPSKATTNINGAR (From saknades): ${est.length}`);
  console.log(`  varav riktiga From-priser:            ${bad.length - est.length}\n`);
  for (const b of bad.slice(0, 60)) {
    console.log(
      `  ${b.ratio.toFixed(0).padStart(5)}x  ${(b.price / 100).toFixed(2).padStart(9)} kr  (var ${(
        b.priorAvg / 100
      ).toFixed(0)} kr)  ${b.stock === "OUT_OF_STOCK" ? "UPPSKATTN" : "From     "}  ${b.title}`
    );
  }
  if (bad.length > 60) console.log(`  … ${bad.length - 60} till`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
