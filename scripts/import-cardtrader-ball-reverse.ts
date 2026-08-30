/**
 * Kör Master Ball / Poké Ball-importen. Torrkörning som standard.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-ball-reverse.ts
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-ball-reverse.ts
 *
 * Efter en skarp körning räknas `lowestPriceOre` om — utan det göms de nya
 * produkterna av `buildProductWhere`.
 */
import "dotenv/config";
import { runCardTraderBallImport } from "../src/jobs/cardtrader-ball-reverse";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.env.APPLY === "1";
const SETS = process.env.SETS ? Number(process.env.SETS) : undefined;

async function main() {
  console.log(APPLY ? "SKARP KÖRNING — skriver till databasen" : "TORRKÖRNING — inget skrivs");
  const t0 = Date.now();
  const r = await runCardTraderBallImport({ apply: APPLY, setLimit: SETS });

  console.log("\n" + "=".repeat(72));
  for (const e of r.perExpansion)
    console.log(
      `  ${e.name.padEnd(46).slice(0, 46)} prissatta ${String(e.priced).padStart(4)} · median ${e.medianEur.toFixed(2).padStart(8)} € · högsta ${e.maxEur.toFixed(2).padStart(9)} €`
    );
  console.log("=".repeat(72));
  console.log(`Boll-expansioner funna:     ${r.expansionsFound}`);
  console.log(`Kort granskade:             ${r.cardsConsidered}`);
  console.log(`  utan blueprint:           ${r.noBlueprint}`);
  console.log(`  avvisade — fel namn:      ${r.rejectedName}`);
  console.log(`  avvisade — för tunt:      ${r.rejectedThin}`);
  console.log(`  avvisade — utliggare:     ${r.rejectedImplausible}`);
  console.log(`PRODUKTER ${APPLY ? "SKAPADE" : "SOM SKULLE SKAPAS"}:  ${r.productsCreated}`);
  console.log(`OFFERS ${APPLY ? "SKRIVNA" : "SOM SKULLE SKRIVAS"}:    ${r.offersUpserted}`);
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
