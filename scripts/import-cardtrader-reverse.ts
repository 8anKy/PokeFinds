/**
 * Kör reverse holo-importen. Torrkörning som standard.
 *
 *   npx tsx scripts/import-cardtrader-reverse.ts                 # torrt, hela katalogen
 *   SETS=5 npx tsx scripts/import-cardtrader-reverse.ts          # torrt, 5 nyaste seten
 *   APPLY=1 npx tsx scripts/import-cardtrader-reverse.ts         # SKRIVER
 *
 * Efter en skarp körning: `recomputeProductPriceCache()` måste ha kört, annars
 * saknar de nya produkterna `lowestPriceOre` och göms av `buildProductWhere`.
 * Skriptet gör det själv vid APPLY.
 */
import "dotenv/config";
import { runCardTraderReverseImport } from "../src/jobs/cardtrader-reverse";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.env.APPLY === "1";
const SETS = process.env.SETS ? Number(process.env.SETS) : undefined;

async function main() {
  console.log(APPLY ? "SKARP KÖRNING — skriver till databasen" : "TORRKÖRNING — inget skrivs");
  const t0 = Date.now();
  const r = await runCardTraderReverseImport({ apply: APPLY, setLimit: SETS });

  console.log("\n" + "=".repeat(60));
  console.log(`Set mappade / omappade:     ${r.setsMatched} / ${r.setsUnmatched}`);
  console.log(`Kort granskade:             ${r.cardsConsidered}`);
  console.log(`  utan blueprint:           ${r.noBlueprint}`);
  console.log(`  avvisade — för tunt:      ${r.rejectedThin}`);
  console.log(`  avvisade — orimlig kvot:  ${r.rejectedImplausible}`);
  console.log(`  TCGdex sa NEJ till reverse: ${r.gateRejected}`);
  console.log(`  TCGdex kunde inte svara:  ${r.gateUnknown}`);
  console.log(`PRODUKTER ${APPLY ? "SKAPADE" : "SOM SKULLE SKAPAS"}:  ${r.productsCreated}`);
  console.log(`OFFERS ${APPLY ? "SKRIVNA" : "SOM SKULLE SKRIVAS"}:    ${r.offersUpserted}`);
  console.log(`Grafpunkter för ORDINARIE kort:  ${r.baseObservations} bedömda`);
  console.log(`Tid: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);

  if (APPLY) {
    console.log("\nRäknar om lowestPriceOre …");
    await recomputeProductPriceCache();
    console.log("klart.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
