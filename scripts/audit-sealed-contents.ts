/**
 * REVISION AV "I LÅDAN" — rapport, skriver inget.
 *
 * Visar per kategori hur många förseglade produkter som får en innehållslista
 * (kurerad tabell eller familjeregel), vilka KURERADE slugs som inte längre
 * finns i katalogen (sammanslagning/omdöpning ⇒ raden tappas tyst) och de mest
 * visade produkterna i lager som fortfarande saknar lista — dvs nästa att
 * researcha för `src/data/sealed-contents-curated.ts`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-sealed-contents.ts [--top 40]
 */
import { PrismaClient } from "@prisma/client";
import { CURATED_SEALED_CONTENTS } from "../src/data/sealed-contents-curated";
import { buildProductFacts } from "../src/lib/product-facts";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const TOP = Number(argv[argv.indexOf("--top") + 1]) || 40;

async function main() {
  const rows = await prisma.product.findMany({
    where: { hiddenAt: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY", "OTHER"] } },
    select: {
      slug: true,
      title: true,
      category: true,
      language: true,
      viewCount: true,
      releaseDate: true,
      set: { select: { name: true, series: true, releaseDate: true, totalCards: true, totalCardsFull: true } },
      offers: { where: { stockStatus: "IN_STOCK" }, select: { id: true }, take: 1 },
    },
  });
  const by = new Map<string, { total: number; covered: number; inStock: number; coveredInStock: number }>();
  const missing: typeof rows = [];
  for (const r of rows) {
    const facts = buildProductFacts({ ...r, card: null });
    const covered = !!facts?.contents?.length;
    const b = by.get(r.category) ?? { total: 0, covered: 0, inStock: 0, coveredInStock: 0 };
    b.total++;
    if (covered) b.covered++;
    if (r.offers.length) {
      b.inStock++;
      if (covered) b.coveredInStock++;
      else missing.push(r);
    }
    by.set(r.category, b);
  }
  console.log("Täckning per kategori (synliga produkter):");
  for (const [cat, b] of [...by.entries()].sort()) {
    console.log(`  ${cat.padEnd(15)} ${b.covered}/${b.total} totalt · i lager ${b.coveredInStock}/${b.inStock}`);
  }
  const slugs = new Set(rows.map((r) => r.slug));
  const orphans = Object.keys(CURATED_SEALED_CONTENTS).filter((s) => !slugs.has(s));
  console.log(`\nKurerade poster: ${Object.keys(CURATED_SEALED_CONTENTS).length}, utan produkt: ${orphans.length}`);
  for (const o of orphans) console.log(`  ⚠️ ${o}`);
  missing.sort((a, b) => b.viewCount - a.viewCount);
  console.log(`\nI lager utan lista: ${missing.length}. Mest visade:`);
  for (const m of missing.slice(0, TOP)) console.log(`  ${String(m.viewCount).padStart(5)}  ${m.category.padEnd(15)} ${m.slug}  —  ${m.title}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
