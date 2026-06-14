/**
 * Fristående jobb-worker. Körs med: npx tsx src/jobs/worker.ts
 *
 * Med Redis: BullMQ-worker som bearbetar schemalagda jobb
 * (insamling + alertutskick + veckorapporter).
 * Utan Redis: setInterval-fallback som var 8:e timme kör
 * runScheduledScrapesOnce + dispatchPendingAlerts.
 */
import { Worker, type Job } from "bullmq";
import { prisma } from "../lib/db";
import { isRedisAvailable } from "../lib/queue";
import { sendMail } from "../lib/mailer";
import { weeklyReportEmail } from "../emails/templates";
import { runAllActiveSources, runScrapeJob } from "../scrapers/runner";
import { dispatchPendingAlerts } from "../services/notifications";
import { runTraderaSweep } from "./tradera-sweep";
import { runCardmarketRefresh } from "./cardmarket-refresh";
import { runRestockWatch } from "./restock-watch";
import {
  SCRAPE_QUEUE_NAME,
  getBullConnection,
  setupRepeatableJobs,
  runScheduledScrapesOnce,
} from "./scheduler";

const FALLBACK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 timmar

/** Skickar veckorapporter (måndagar) till användare som valt det. */
async function maybeSendWeeklyReports(): Promise<void> {
  const now = new Date();
  if (now.getDay() !== 1) {
    console.log("[worker] Ingen veckorapport idag (skickas måndagar).");
    return;
  }
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: { watchlistItems: { some: {} } },
    include: { watchlistItems: { select: { productId: true } } },
    take: 1000,
  });

  let sentCount = 0;
  for (const user of users) {
    const settings = user.notificationSettings as { weeklyReport?: boolean; email?: boolean };
    if (settings?.weeklyReport === false || settings?.email === false) continue;

    const productIds = user.watchlistItems.map((w) => w.productId);
    try {
      const restocks = await prisma.restockEvent.count({
        where: {
          productId: { in: productIds },
          newStatus: "IN_STOCK",
          detectedAt: { gte: weekAgo },
        },
      });
      // Prisfall: produkter vars senaste snapshot är billigare än för en vecka sedan
      let priceDrops = 0;
      for (const productId of productIds.slice(0, 50)) {
        const [latest, oldSnap] = await Promise.all([
          prisma.priceSnapshot.findFirst({
            where: { productId },
            orderBy: { date: "desc" },
          }),
          prisma.priceSnapshot.findFirst({
            where: { productId, date: { lte: weekAgo } },
            orderBy: { date: "desc" },
          }),
        ]);
        if (latest && oldSnap && latest.avgPrice < oldSnap.avgPrice) priceDrops++;
      }

      const mail = weeklyReportEmail(user.name, {
        watchedProducts: productIds.length,
        priceDrops,
        restocks,
      });
      await sendMail({ to: user.email, ...mail });
      sentCount++;
    } catch (err) {
      console.error(`[worker] Veckorapport misslyckades för ${user.id}:`, err);
    }
  }
  console.log(`[worker] Veckorapporter skickade: ${sentCount}`);
}

async function processJob(job: Job): Promise<void> {
  console.log(`[worker] Bearbetar jobb "${job.name}" (${job.id})`);
  switch (job.name) {
    case "scrape-all": {
      const summaries = await runAllActiveSources();
      console.log(`[worker] Insamling klar: ${summaries.length} källor.`);
      const alerts = await dispatchPendingAlerts();
      console.log(`[worker] Alerts: ${alerts.sent} skickade, ${alerts.failed} misslyckade.`);
      break;
    }
    case "scrape-source": {
      const sourceId = (job.data as { sourceId?: string }).sourceId;
      if (!sourceId) throw new Error("scrape-source kräver sourceId i jobbdata.");
      const summary = await runScrapeJob(sourceId);
      console.log(`[worker] Källa klar: ${JSON.stringify(summary)}`);
      await dispatchPendingAlerts();
      break;
    }
    case "dispatch-alerts": {
      const alerts = await dispatchPendingAlerts();
      console.log(`[worker] Alerts: ${alerts.sent} skickade, ${alerts.failed} misslyckade.`);
      break;
    }
    case "weekly-report-check": {
      await maybeSendWeeklyReports();
      break;
    }
    case "tradera-sweep": {
      if (!process.env.TRADERA_APP_ID || !process.env.TRADERA_APP_KEY) {
        console.warn("[worker] Tradera-svep hoppas över — TRADERA_APP_ID/APP_KEY saknas.");
        break;
      }
      const result = await runTraderaSweep();
      console.log(
        `[worker] Tradera-svep klar: ${result.matchedProducts} produkter, ` +
          `${result.written} skrivna, ${result.priceUpdated} billigare, ${result.expired} utgångna.`
      );
      await dispatchPendingAlerts();
      break;
    }
    case "cardmarket-refresh": {
      const r = await runCardmarketRefresh();
      console.log(
        `[worker] CM-refresh klar: ${r.singlesUpdated} singlar, ${r.sealedUpdated} sealed, ${r.apiCalls} anrop.`
      );
      await dispatchPendingAlerts();
      break;
    }
    case "restock-watch": {
      const r = await runRestockWatch();
      console.log(`[worker] Restock-watch klar: ${r.sources} källor, ${r.alertsSent} alerts.`);
      break;
    }
    default:
      console.warn(`[worker] Okänt jobbnamn: ${job.name}`);
  }
}

async function main(): Promise<void> {
  console.log("[worker] PokeFinds jobb-worker startar...");

  // Ge Redis-anslutningen en kort stund att etableras
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (isRedisAvailable()) {
    const connection = getBullConnection();
    if (connection) {
      await setupRepeatableJobs();
      const worker = new Worker(SCRAPE_QUEUE_NAME, processJob, {
        connection,
        concurrency: 1,
      });
      worker.on("completed", (job) => console.log(`[worker] Jobb ${job.id} klart.`));
      worker.on("failed", (job, err) =>
        console.error(`[worker] Jobb ${job?.id} misslyckades:`, err.message)
      );
      console.log("[worker] BullMQ-worker igång (Redis-läge).");
      return; // Worker håller processen vid liv
    }
  }

  // Fallback utan Redis: enkel intervall-loop
  console.log(
    `[worker] Redis ej tillgänglig — fallback-läge med intervall var ${FALLBACK_INTERVAL_MS / 3_600_000}:e timme.`
  );
  let lastTraderaSweepDay = "";
  let lastCmRefreshDay = "";
  const tick = async (): Promise<void> => {
    try {
      await runScheduledScrapesOnce();
      await dispatchPendingAlerts();

      const today = new Date().toISOString().slice(0, 10);
      // Tradera-svep max en gång per kalenderdygn (egen 24h-kvot).
      if (
        today !== lastTraderaSweepDay &&
        process.env.TRADERA_APP_ID &&
        process.env.TRADERA_APP_KEY
      ) {
        lastTraderaSweepDay = today;
        const result = await runTraderaSweep();
        console.log(
          `[worker] Tradera-svep klar: ${result.matchedProducts} produkter, ` +
            `${result.written} skrivna, ${result.priceUpdated} billigare, ${result.expired} utgångna.`
        );
      }
      // Cardmarket-prisrefresh max en gång per kalenderdygn (RapidAPI 3000/dygn).
      if (today !== lastCmRefreshDay && process.env.CARDMARKET_RAPIDAPI_KEY) {
        lastCmRefreshDay = today;
        const r = await runCardmarketRefresh();
        console.log(`[worker] CM-refresh klar: ${r.singlesUpdated} singlar, ${r.sealedUpdated} sealed.`);
      }
    } catch (err) {
      console.error("[worker] Fel i fallback-loop:", err);
    }
  };
  await tick(); // Kör direkt vid start
  setInterval(() => {
    void tick();
  }, FALLBACK_INTERVAL_MS);

  // Frekvent restock-bevakning (separat, lättare än 8h-ticken).
  const restockMs = parseInt(process.env.RESTOCK_WATCH_MINUTES ?? "45", 10) * 60 * 1000;
  if (restockMs > 0) {
    setInterval(() => {
      void runRestockWatch().catch((e) => console.error("[worker] restock-watch:", e));
    }, restockMs);
  }
}

main().catch((err) => {
  console.error("[worker] Fatalt fel:", err);
  process.exit(1);
});
