/**
 * Schemaläggning av återkommande jobb.
 * Med Redis: BullMQ-kö med repeterbara jobb
 *   - "scrape-all": var 8:e timme (alla aktiva källor)
 *   - "weekly-report-check": varje morgon 08:00 (skickar veckorapporter på måndagar)
 * Utan Redis: använd runScheduledScrapesOnce() manuellt / via cron-route.
 */
/**
 * BullMQ importeras dynamiskt via __non_webpack_require__ för att undvika
 * att webpack försöker bundla Node.js-beroenden (crypto, path, child_process)
 * som inte finns i edge-/klient-miljön.
 */
declare const __non_webpack_require__: typeof require;
const nodeRequire =
  typeof __non_webpack_require__ !== "undefined"
    ? __non_webpack_require__
    : require;

import { isRedisAvailable } from "@/lib/queue";
import { runAllActiveSources, type ScrapeJobSummary } from "@/scrapers/runner";
import { dispatchPendingAlerts } from "@/services/notifications";
import { recomputeProductPriceCache } from "@/services/products";

export const SCRAPE_QUEUE_NAME = "pokefinds-jobs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queue: any = null;

export interface BullConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

/**
 * Anslutningsalternativ för BullMQ utifrån REDIS_URL.
 * (BullMQ kräver maxRetriesPerRequest: null — därför inte getRedis().)
 */
export function getBullConnection(): BullConnectionOptions | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6379,
      username: u.username || undefined,
      password: u.password || undefined,
      db: u.pathname && u.pathname !== "/" ? parseInt(u.pathname.slice(1), 10) : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    console.warn("[scheduler] Ogiltig REDIS_URL — BullMQ inaktiverad.");
    return null;
  }
}

export async function getJobQueue() {
  if (queue) return queue;
  const connection = getBullConnection();
  if (!connection) return null;
  const { Queue } = nodeRequire("bullmq");
  queue = new Queue(SCRAPE_QUEUE_NAME, { connection });
  return queue;
}

/**
 * Registrerar repeterbara jobb i BullMQ. Anropas från worker vid uppstart.
 * Returnerar false om Redis saknas (fallback-läge).
 */
export async function setupRepeatableJobs(): Promise<boolean> {
  if (!isRedisAvailable()) {
    console.log("[scheduler] Redis ej tillgänglig — använd runScheduledScrapesOnce() via cron.");
    return false;
  }
  const q = await getJobQueue();
  if (!q) return false;

  try {
    // Skrapa alla aktiva källor var 8:e timme
    await q.add(
      "scrape-all",
      {},
      { repeat: { every: 8 * 60 * 60 * 1000 }, removeOnComplete: 20, removeOnFail: 50 }
    );
    // Veckorapport-koll varje morgon kl 08:00
    await q.add(
      "weekly-report-check",
      {},
      { repeat: { pattern: "0 8 * * *" }, removeOnComplete: 20, removeOnFail: 50 }
    );
    // Tradera-svepning EN gång per dygn kl 04:00 — egen 24h-kvot, får inte
    // ligga i scrape-all (var 8:e h) som annars skulle tömma kvoten direkt.
    await q.add(
      "tradera-sweep",
      {},
      { repeat: { pattern: "0 4 * * *" }, removeOnComplete: 10, removeOnFail: 20 }
    );
    // Cardmarket-prisrefresh EN gång per dygn kl 05:00 — RapidAPI Pro-kvot
    // (3000/dygn); en full körning ~1100 anrop, får inte ligga i scrape-all.
    await q.add(
      "cardmarket-refresh",
      {},
      { repeat: { pattern: "0 5 * * *" }, removeOnComplete: 10, removeOnFail: 20 }
    );
    // Restock-bevakning var ~45:e minut (lätta butiks-källor flaggade
    // restockWatch) → tidiga restock-alerts.
    const restockMinutes = parseInt(process.env.RESTOCK_WATCH_MINUTES ?? "45", 10);
    await q.add(
      "restock-watch",
      {},
      { repeat: { every: restockMinutes * 60 * 1000 }, removeOnComplete: 20, removeOnFail: 50 }
    );
    console.log("[scheduler] Repeterbara jobb registrerade (scrape var 8:e timme, rapport 08:00, Tradera-svep 04:00, CM-refresh 05:00).");
    return true;
  } catch (err) {
    console.error("[scheduler] Kunde inte registrera repeterbara jobb:", err);
    return false;
  }
}

/**
 * Kör ett schemalagt insamlingspass synkront (utan Redis):
 * alla aktiva källor + utskick av väntande alerts.
 * Används av cron-routen och worker-fallbacken.
 */
export async function runScheduledScrapesOnce(): Promise<{
  scrapes: ScrapeJobSummary[];
  alerts: { sent: number; failed: number };
}> {
  console.log("[scheduler] Kör schemalagt insamlingspass...");
  const scrapes = await runAllActiveSources();
  // Uppdatera denormaliserat lägstapris (katalog-feed: sortering + gömning).
  await recomputeProductPriceCache();
  const alerts = await dispatchPendingAlerts();
  console.log(
    `[scheduler] Klart: ${scrapes.length} källor, ${alerts.sent} alerts skickade, ${alerts.failed} misslyckade.`
  );
  return { scrapes, alerts };
}
