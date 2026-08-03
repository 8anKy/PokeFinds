/**
 * Kör 1st Edition-importen (WOTC-seten). Torrkörning som standard.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-first-edition.ts
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/import-cardtrader-first-edition.ts
 */
import "dotenv/config";
import { runCardTraderFirstEditionImport } from "../src/jobs/cardtrader-first-edition";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.env.APPLY === "1";
const SETS = process.env.SETS ? Number(process.env.SETS) : undefined;

async function main() {
  console.log(APPLY ? "SKARP KÖRNING — skriver till databasen" : "TORRKÖRNING — inget skrivs");
  const t0 = Date.now();
  const r = await runCardTraderFirstEditionImport({ apply: APPLY, setLimit: SETS });

  console.log("\n" + "=".repeat(72));
  for (const s of r.perSet)
    console.log(
      `  ${s.name.padEnd(26).slice(0, 26)} prissatta ${String(s.priced).padStart(4)} · median ${s.medianEur.toFixed(2).padStart(8)} € · högsta ${s.maxEur.toFixed(2).padStart(9)} €`
    );
  console.log("=".repeat(72));
  console.log(`Set med 1st Edition enligt TCGdex: ${r.setsConsidered}`);
  console.log(`  varav bearbetade:         ${r.setsGated}`);
  console.log(`Kort granskade:             ${r.cardsConsidered}`);
  console.log(`  utan blueprint:           ${r.noBlueprint}`);
  console.log(`  avvisade — för tunt:      ${r.rejectedThin}`);
  console.log(`  avvisade — orimlig kvot:  ${r.rejectedImplausible}`);
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
