/**
 * Kör reverse holo-importen. Torrkörning som standard.
 *
 *   npx tsx scripts/import-cardtrader-reverse.ts                 # torrt, hela katalogen
 *   SETS=5 npx tsx scripts/import-cardtrader-reverse.ts          # torrt, 5 STALASTE seten
 *   MINUTES=44 npx tsx scripts/import-cardtrader-reverse.ts      # slutar frivilligt efter 44 min
 *   APPLY=1 npx tsx scripts/import-cardtrader-reverse.ts         # SKRIVER
 *
 * ⛔ MINUTES ÄR DEN RIKTIGA GRINDEN I DRIFT, inte SETS. Ett setantal är en
 * tidsbudget i fel enhet — se kommentaren vid `deadline` i
 * src/jobs/cardtrader-reverse.ts. Sätt den LÄGRE än workflowets
 * `timeout-minutes` minus de tidigare stegen, så att raden nedan hinner köras.
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
const MINUTES = process.env.MINUTES ? Number(process.env.MINUTES) : undefined;

async function main() {
  console.log(APPLY ? "SKARP KÖRNING — skriver till databasen" : "TORRKÖRNING — inget skrivs");
  const t0 = Date.now();
  const r = await runCardTraderReverseImport({
    apply: APPLY,
    setLimit: SETS,
    budgetMs: MINUTES && MINUTES > 0 ? MINUTES * 60_000 : undefined,
  });

  console.log("\n" + "=".repeat(60));
  console.log(`Set mappade / omappade:     ${r.setsMatched} / ${r.setsUnmatched}`);
  console.log(`Set körda:                  ${r.setsProcessed}`);
  // ⛔ EN BUDGETSTOPPAD KÖRNING FÅR INTE VARA TYST. Delvis täckning är BY DESIGN
  // (stalast först ⇒ svansen ligger överst i morgon), så den ska inte färga
  // körningen röd — men en `console.log` bland tusen rader syns inte, och just
  // "grönt fast nästan inget hände" är felläget som gav 13 verkningslösa gröna
  // körningar 2026-08-17. `::warning::` hamnar på körningens sammanfattning och
  // syns utan att någon öppnar loggen. Utanför Actions är det bara en textrad.
  if (r.stoppedOnBudget) {
    console.log(
      `::warning::Tidsbudgeten tog slut efter ${r.setsProcessed} set — resten körs först nästa natt. Sjunker talet natt för natt är passet på väg att bli för långsamt för fönstret.`
    );
  }
  console.log(`Kort granskade:             ${r.cardsConsidered}`);
  console.log(`  utan blueprint:           ${r.noBlueprint}`);
  console.log(`  avvisade — för tunt:      ${r.rejectedThin}`);
  console.log(`  avvisade — orimlig kvot:  ${r.rejectedImplausible}`);
  // ⛔ "MARKNADEN SAKNAS" ÄR INTE SAMMA SAK SOM "VI FÄLLDE KORTET". Raden fanns
  // inte förut (grind 5c gjorde ett tyst `continue`), och utan den ser bortfallet
  // ut som noll — vilket är precis den siffra beslutet om prislösa
  // reverse-produkter ska vila på.
  console.log(`  inga reverse-annonser alls: ${r.noReverseMarket}`);
  console.log(`  TCGdex sa NEJ till reverse: ${r.gateRejected}`);
  console.log(`  TCGdex kunde inte svara:  ${r.gateUnknown}`);
  console.log(`Set med OANVÄNDBAR TCGdex-taxonomi: ${r.dexDistrustedSets}`);
  console.log(`PRODUKTER ${APPLY ? "SKAPADE" : "SOM SKULLE SKAPAS"}:  ${r.productsCreated}`);
  console.log(`OFFERS ${APPLY ? "SKRIVNA" : "SOM SKULLE SKRIVAS"}:    ${r.offersUpserted}`);
  console.log(`ORDINARIE kort — grafpunkter:    ${r.baseObservations} bedömda`);
  console.log(`ORDINARIE kort — CardTrader-offers: ${r.baseOffers}`);
  console.log(`ORDINARIE kort — orimligt låga:  ${r.baseImplausible} (ej publicerade)`);
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
