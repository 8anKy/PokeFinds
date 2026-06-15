/**
 * CLI-wrapper för ett komplett schemalagt insamlingspass: alla aktiva skrapor
 * (butiker, Tradera, CM-prisguide) + priscache-omräkning + alert-utskick.
 * Samma kärna som instrumentation/8h-ticken (src/jobs/scheduler.ts). Körs i CI:
 *   npx tsx scripts/scrape-all-run.ts
 */
import { prisma } from "../src/lib/db";
import { runScheduledScrapesOnce } from "../src/jobs/scheduler";

runScheduledScrapesOnce()
  .then((r) => console.log(`Klart: ${r.scrapes.length} källor, ${r.alerts.sent} alerts skickade.`))
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
