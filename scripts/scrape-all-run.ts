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
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Avsluta EXPLICIT. Någon kvarlämnad handle (HTTP-socket/timer från en skrapa)
    // håller event-loopen vid liv efter att arbetet är klart: 1–8 juli 2026 skrev
    // jobbet sin sista rad efter ~99 min och satt sedan sysslolöst tills GitHub
    // dödade det på 120-minuterstaket. "cancelled" skickar inget felmejl → det
    // brann Actions-minuter i en vecka utan att någon märkte det.
    process.exit(process.exitCode ?? 0);
  });
