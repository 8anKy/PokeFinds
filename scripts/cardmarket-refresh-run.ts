/**
 * CLI-wrapper för den dagliga Cardmarket-prisuppdateringen (RapidAPI Pro).
 * Kärnlogiken bor i src/jobs/cardmarket-refresh.ts (delas med schemaläggaren).
 * Körs i CI (GitHub Actions) eller manuellt:
 *   npx tsx scripts/cardmarket-refresh-run.ts
 * Env (DATABASE_URL, CARDMARKET_RAPIDAPI_*) läses från process.env.
 */
import { prisma } from "../src/lib/db";
import { runCardmarketRefresh } from "../src/jobs/cardmarket-refresh";

// FAILA HÖGT PÅ SAKNAD NYCKEL. runCardmarketRefresh() bara WARNAR och returnerar när
// CARDMARKET_RAPIDAPI_KEY saknas — rätt för webbappen/dev (ingen nyckel = ingen krasch),
// men KATASTROF här: jobbet blir GRÖNT medan ett helt dygns sealed- och singelpriser
// tyst uteblir. Exakt det hände 2026-07-14 lokalt: körningen gick igenom med exit 0 och
// gjorde ingenting, eftersom with-prod-db bara injicerar DATABASE_URL.
// Actions SÄTTER nyckeln — saknas den är det ett fel, inte ett läge att hoppa över.
for (const v of ["CARDMARKET_RAPIDAPI_KEY", "DATABASE_URL"]) {
  if (!process.env[v]) {
    console.error(
      `[cm-refresh] ${v} saknas — AVBRYTER. En grön körning utan nyckel = ett dygns ` +
        `priser tyst förlorade. Kör lokalt med: npx tsx -r dotenv/config scripts/cardmarket-refresh-run.ts`,
    );
    process.exit(1);
  }
}

runCardmarketRefresh()
  .then((r) =>
    console.log(
      `Klart: ${r.singlesUpdated} singlar, ${r.singlesCreated} nya, ${r.sealedUpdated} sealed, ${r.apiCalls} API-anrop (kvot kvar ${r.remaining}).`
    )
  )
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
