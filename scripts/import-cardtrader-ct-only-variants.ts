/**
 * Varianter som bara finns hos CardTrader (Peelable Ditto …). Torrkörning som standard.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-ct-only-variants.ts
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-ct-only-variants.ts
 */
import "dotenv/config";
import { runCtOnlyVariants } from "../src/jobs/cardtrader-ct-only-variants";
import { recomputeProductPriceCache } from "../src/services/products";
import { exitJob } from "../src/lib/job-exit";

const APPLY = process.env.APPLY === "1";

async function main() {
  console.log(APPLY ? "SKARP KÖRNING — skriver till databasen" : "TORRKÖRNING — inget skrivs");
  const r = await runCtOnlyVariants({ apply: APPLY });
  console.log(`Prissatta: ${r.priced} · nya produkter: ${r.created}`);
  for (const s of r.skipped) console.log(`  hoppade: ${s}`);
  if (APPLY) await recomputeProductPriceCache();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void exitJob());
