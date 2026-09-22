/**
 * Raderar `GradedSale`-rader som ligger på FÖRSEGLADE produkter (2026-09-22).
 * Förseglat har ingen graderad serie — se `gradingVerdictFor` i graded-listing.ts.
 * Dry run som default; `--apply` raderar.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-sealed-graded-sales.ts [--apply]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.gradedSale.findMany({
    where: { product: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } } },
    select: { id: true, title: true, price: true, product: { select: { slug: true } } },
  });
  for (const r of rows) console.log(`${r.product.slug}  ${r.price / 100} kr  ${r.title}`);
  console.log(`\n${rows.length} rader på förseglade produkter.`);
  if (!apply) {
    console.log("Dry run — kör med --apply för att radera.");
    return;
  }
  const { count } = await prisma.gradedSale.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  console.log(`Raderade ${count}.`);
}

main().finally(() => prisma.$disconnect());
