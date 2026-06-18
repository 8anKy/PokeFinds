/**
 * CLI-wrapper för hot-card-refresh (de mest bevakade/visade kortens From-pris,
 * flera gånger/dygn). Kärnlogiken bor i src/jobs/hot-card-refresh.ts.
 * Körs i CI (GitHub Actions) eller manuellt:
 *   npx tsx scripts/hot-card-refresh-run.ts
 * Env (DATABASE_URL, CARDMARKET_RAPIDAPI_*, HOT_CARD_LIMIT) läses från process.env.
 */
import { prisma } from "../src/lib/db";
import { runHotCardRefresh } from "../src/jobs/hot-card-refresh";

runHotCardRefresh()
  .then((r) =>
    console.log(`Klart: ${r.updated} kort uppdaterade, ${r.apiCalls} API-anrop (kvot kvar ${r.remaining}).`)
  )
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
