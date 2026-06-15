/**
 * CLI-wrapper för den dagliga Cardmarket-prisuppdateringen (RapidAPI Pro).
 * Kärnlogiken bor i src/jobs/cardmarket-refresh.ts (delas med schemaläggaren).
 * Körs i CI (GitHub Actions) eller manuellt:
 *   npx tsx scripts/cardmarket-refresh-run.ts
 * Env (DATABASE_URL, CARDMARKET_RAPIDAPI_*) läses från process.env.
 */
import { prisma } from "../src/lib/db";
import { runCardmarketRefresh } from "../src/jobs/cardmarket-refresh";

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
