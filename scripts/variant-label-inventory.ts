/**
 * Vilka `variantLabel` finns redan i katalogen, och hur många produkter bär dem?
 * Underlag innan reverse holo-produkter skapas: fältet är REDAN lastbärande i
 * cardmarket-refresh (variantLabel != null ⇒ prissätts via pokemontcg.io-trend)
 * och i tryckningsvakten (isPrintVariantLabel). Ren läsning.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.product.groupBy({
    by: ["variantLabel"],
    _count: { _all: true },
    orderBy: { _count: { variantLabel: "desc" } },
  });
  console.log("variantLabel-fördelning:");
  for (const r of rows) {
    console.log(`  ${String(r.variantLabel ?? "(null)").padEnd(28)} ${r._count._all}`);
  }

  const labels = rows.map((r) => r.variantLabel).filter((l): l is string => !!l);
  for (const label of labels.slice(0, 12)) {
    const sample = await prisma.product.findMany({
      where: { variantLabel: label },
      select: { title: true, slug: true, lowestPriceOre: true, category: true },
      take: 3,
    });
    console.log(`\n${label}:`);
    for (const s of sample) {
      console.log(`   ${s.title} · ${s.category} · ${s.lowestPriceOre ?? "–"} öre`);
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
