/**
 * Dumpar katalogens sealed-produkter (titel + kategori + språk) till JSON.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/dump-catalog-titles.ts --out=catalog.json
 *
 * Underlag för FALSKLARMS-MÄTNING av vaktändringar: en vakt som fäller en produkt vi
 * REDAN har i katalogen är per definition för bred. Samma metod som mätningen bakom
 * samlarnummer-tecknet 2026-08-07 ("0 av 1 633 sealed-produkter träffas").
 */
import "./load-env";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { SEALED_CATEGORY_EXCLUSIONS } from "../src/lib/product-category";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "catalog.json";

async function main() {
  const rows = await prisma.product.findMany({
    where: { category: { notIn: [...SEALED_CATEGORY_EXCLUSIONS] } },
    select: { id: true, title: true, category: true, language: true, slug: true },
  });
  writeFileSync(out, JSON.stringify(rows));
  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  console.log(`[dump] ${rows.length} sealed-produkter → ${out}`);
  console.log(byCat);
}

main().finally(() => prisma.$disconnect());
