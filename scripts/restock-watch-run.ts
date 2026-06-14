/**
 * CLI-wrapper för den frekventa restock-bevakningen. Kärnlogiken bor i
 * src/jobs/restock-watch.ts (delas med schemaläggaren/instrumentation).
 * Kör manuellt:  npx tsx scripts/restock-watch-run.ts
 */
import { prisma } from "../src/lib/db";
import { runRestockWatch } from "../src/jobs/restock-watch";

runRestockWatch()
  .catch((e) => { console.error("Misslyckades:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
