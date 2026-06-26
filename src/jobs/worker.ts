/**
 * Fristående jobb-worker. Körs med: npx tsx src/jobs/worker.ts
 *
 * Med Redis: BullMQ-worker som bearbetar schemalagda jobb
 * (insamling + alertutskick + veckorapporter).
 * Utan Redis: setInterval-fallback som var 8:e timme kör
 * runScheduledScrapesOnce + dispatchPendingAlerts.
 */
import { Worker, type Job } from "bullmq";
import { isRedisAvailable } from "../lib/queue";
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
  console.log("[worker] Foilio jobb-worker startar...");

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
