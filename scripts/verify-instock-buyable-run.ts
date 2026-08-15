/**
 * CLI för verifyInStockBuyable — hittar (och rättar) offers som står "i lager" fast
 * butikens köpknapp är låst.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-instock-buyable-run.ts            # torrkörning, dagens skärva
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-instock-buyable-run.ts --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-instock-buyable-run.ts --all --apply   # hela stocken (engångsstädning)
 *
 * Butikslistan härleds ur adapterregistret (`instanceof ShopifyAdapter`) — ingen
 * handhållen lista att glömma när en butik läggs till.
 */
import "./load-env";
import { SourceType } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/scrapers/runner";
import { ShopifyAdapter } from "../src/scrapers/adapters/shopify-adapter";
import { verifyInStockBuyable } from "../src/jobs/verify-instock-buyable";

const apply = process.argv.includes("--apply");
const all = process.argv.includes("--all");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 120);
// Kommaseparerad butikslista. Finns för att en RÄTTELSE inte ska kräva att alla 26
// butikers produktsidor hämtas igen: torrkörningen pekar ut butiken, och `--apply`
// behöver då bara röra den.
const storeFilter = process.argv
  .find((a) => a.startsWith("--store="))
  ?.slice("--store=".length)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const storeNames = sources
    .filter((s) => s.type === SourceType.SCRAPER)
    .filter((s) => !storeFilter || storeFilter.includes(s.name))
    .filter((s) => {
      try {
        return getAdapter(s.type, s.name) instanceof ShopifyAdapter;
      } catch {
        return false;
      }
    })
    .map((s) => s.name);

  console.log(`[buy-check] ${storeNames.length} Shopify-butiker: ${storeNames.join(", ")}`);
  const res = await verifyInStockBuyable({
    storeNames,
    apply,
    // --all = en skärva som rymmer allt (engångsstädning efter att vakten byggts).
    ...(all ? { shards: 1, shard: 0, limit: 100000 } : { limit }),
  });

  console.log(
    `[buy-check] ${res.candidates} i-lager-offers totalt, ${res.checked} kontrollerade denna körning, ` +
      `${res.unknown} obestämbara, ${res.fixed} FALSKT "i lager"${apply ? " (rättade)" : " (torrkörning)"}.`
  );
  for (const u of res.fixedUrls) console.log(`   ⛔ ${u}`);
  if (!apply && res.fixed > 0) console.log(`\nKör om med --apply för att skriva.`);
}

main().finally(() => prisma.$disconnect());
