/**
 * CLI-wrapper för ett komplett schemalagt insamlingspass: alla aktiva skrapor
 * (butiker, Tradera, CM-prisguide) + priscache-omräkning + alert-utskick.
 * Samma kärna som instrumentation/8h-ticken (src/jobs/scheduler.ts). Körs i CI:
 *   npx tsx scripts/scrape-all-run.ts
 */
import { prisma, ensureDbAwake } from "../src/lib/db";
import { runScheduledScrapesOnce } from "../src/jobs/scheduler";
import { refreshPopularityScores } from "../src/services/market";
import { refreshRankScores } from "../src/jobs/rank-refresh";

// Engagemangsloggen (AnalyticsEvent) skrivs per händelse och behövs bara för
// Trendar-fönstret (7 d) + admin-engagemang (30 d). Rensa allt äldre än detta så
// tabellen inte sväller obegränsat och fönsterfrågorna hålls snabba.
const ANALYTICS_RETENTION_DAYS = 90;

// Lagringsminimering, GDPR art. 5(1)(e) — ägarbeslut 2026-08-09: interna driftrader
// rensas efter 12 månader. Gäller ScannerJob (diagnostik; kvoten räknar bara
// innevarande månad), Alert (skickade larm; cooldown-/flappvakterna läser dygn,
// aldrig år) och AuditLog. Fönstret är PUBLICERAT i integritetspolicyns
// lagringstidsavsnitt — ändras talet måste policytexten ändras med.
// ⛔ GradingJob rensas MED FLIT INTE: "Senaste graderingar" är en synlig funktion
// och policyn lovar lagring så länge kontot finns. Samling/portfölj berörs aldrig.
const INTERNAL_RETENTION_DAYS = 365;

async function main() {
  // Väck Neon före första riktiga frågan — se ensureDbAwake.
  await ensureDbAwake();
  const r = await runScheduledScrapesOnce();
  console.log(`Klart: ${r.scrapes.length} källor, ${r.alerts.sent} alerts skickade.`);

  const cutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 3600 * 1000);
  const pruned = await prisma.analyticsEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (pruned.count > 0) {
    console.log(`Rensade ${pruned.count} analyshändelser äldre än ${ANALYTICS_RETENTION_DAYS} d.`);
  }

  const internalCutoff = new Date(Date.now() - INTERNAL_RETENTION_DAYS * 24 * 3600 * 1000);
  const [oldScans, oldAlerts, oldAudits] = await prisma.$transaction([
    prisma.scannerJob.deleteMany({ where: { createdAt: { lt: internalCutoff } } }),
    prisma.alert.deleteMany({ where: { triggeredAt: { lt: internalCutoff } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: internalCutoff } } }),
  ]);
  if (oldScans.count + oldAlerts.count + oldAudits.count > 0) {
    console.log(
      `Lagringsminimering (${INTERNAL_RETENTION_DAYS} d): ${oldScans.count} skanningar, ` +
        `${oldAlerts.count} larm, ${oldAudits.count} auditrader rensade.`
    );
  }

  // Engagemangsvolymen (30 d) skrivs till Product.viewCount …
  const pop = await refreshPopularityScores();
  console.log(`Populärpoäng uppdaterade: ${pop.updated} produkter.`);

  // … och är en av ingredienserna i kvalitetspoängen (Product.rankScore = katalogens
  // "bäst matchning"-ordning). MÅSTE därför köras EFTER raden ovan.
  const rank = await refreshRankScores();
  console.log(`Rankningspoäng: ${rank.updated} ändrade av ${rank.scanned} produkter.`);
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
