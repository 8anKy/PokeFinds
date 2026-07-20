/**
 * CLI-wrapper för ett komplett schemalagt insamlingspass: alla aktiva skrapor
 * (butiker, Tradera, CM-prisguide) + priscache-omräkning + alert-utskick.
 * Samma kärna som instrumentation/8h-ticken (src/jobs/scheduler.ts). Körs i CI:
 *   npx tsx scripts/scrape-all-run.ts
 */
import { prisma } from "../src/lib/db";
import { runScheduledScrapesOnce } from "../src/jobs/scheduler";
import { refreshPopularityScores } from "../src/services/market";

// Engagemangsloggen (AnalyticsEvent) skrivs per händelse och behövs bara för
// Trendar-fönstret (7 d) + admin-engagemang (30 d). Rensa allt äldre än detta så
// tabellen inte sväller obegränsat och fönsterfrågorna hålls snabba.
const ANALYTICS_RETENTION_DAYS = 90;

async function main() {
  const r = await runScheduledScrapesOnce();
  console.log(`Klart: ${r.scrapes.length} källor, ${r.alerts.sent} alerts skickade.`);

  const cutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 3600 * 1000);
  const pruned = await prisma.analyticsEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (pruned.count > 0) {
    console.log(`Rensade ${pruned.count} analyshändelser äldre än ${ANALYTICS_RETENTION_DAYS} d.`);
  }

  // "Mest populär" = 30-dagars engagemangsvolym, skriven till Product.viewCount.
  const pop = await refreshPopularityScores();
  console.log(`Populärpoäng uppdaterade: ${pop.updated} produkter.`);
}

main()
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
