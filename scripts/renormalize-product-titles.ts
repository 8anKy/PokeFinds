/**
 * `Product.normalizedTitle` = `normalizeTitle(title)`, ALLTID (2026-11-06).
 *
 * Matcharen jämför butikstitlar genom `normalizeTitle` och läser katalogens lagrade
 * `normalizedTitle` rakt av. 740 produkter bar en ANNAN form — Cardmarket-importens egen
 * normalisering ("3 pack", "build and battle", "super premium") och äldre singelrader med
 * "·" — så en butikstitel som var identisk med katalogens föll ändå: Super-Premium-vakten
 * såg "super-premium" mot "super premium", Delta Reigns Build & Battle Box förlorade mot
 * Chilling Reigns kit. Skriptet räknar om de rader som avviker; steg i cardmarket-refresh
 * efter sealed-importen så att en ny skrivare med egen form läker samma natt.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/renormalize-product-titles.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/renormalize-product-titles.ts --apply   # skriver
 */
import { prisma } from "../src/lib/db";
import { normalizeTitle } from "../src/lib/utils";
import { mapPool } from "../src/lib/concurrency";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.product.findMany({ select: { id: true, title: true, normalizedTitle: true } });
  const stale = rows
    .map((r) => ({ ...r, next: normalizeTitle(r.title) }))
    .filter((r) => r.next && r.next !== r.normalizedTitle);
  console.log(`Produkter: ${rows.length}, avvikande normalizedTitle: ${stale.length}`);
  for (const r of stale.slice(0, 10)) console.log(`  "${r.normalizedTitle}" → "${r.next}"`);
  if (!APPLY) {
    console.log("TORRKÖRNING — inget skrivet. --apply skriver.");
    return;
  }
  // updateMany på id: rör inte @updatedAt-semantiken mer än nödvändigt och är idempotent.
  await mapPool(stale, 8, async (r) => {
    await prisma.product.updateMany({ where: { id: r.id }, data: { normalizedTitle: r.next } });
  });
  console.log(`✅ ${stale.length} rader omräknade.`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
