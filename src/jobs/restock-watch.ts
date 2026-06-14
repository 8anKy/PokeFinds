/**
 * Frekvent restock-bevakning (Wave 1). Kör ENBART de källor som flaggats med
 * `config.restockWatch = true` (lätta JSON-butiker + befintliga butiks-adaptrar)
 * och skickar väntande alerts. Tänkt att köras var ~30–60:e minut → tidiga
 * restock-alerts utan att belasta den fulla 8h-insamlingen (priskällor m.m.).
 *
 * Restock-detektering sker i runnern: när en offer går OUT_OF_STOCK → IN_STOCK
 * skapas en RestockEvent och `checkRestockAlerts` notifierar bevakare.
 *
 * Delas av jobb-schemaläggaren (worker/instrumentation) + CLI-wrappern
 * scripts/restock-watch-run.ts.
 */
import { prisma } from "../lib/db";
import { runScrapeJob } from "../scrapers/runner";
import { dispatchPendingAlerts } from "../services/notifications";

export interface RestockWatchResult {
  sources: number;
  itemsUpdated: number;
  alertsSent: number;
}

export async function runRestockWatch(): Promise<RestockWatchResult> {
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const watch = active.filter(
    (s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true
  );
  if (watch.length === 0) {
    console.log("[restock-watch] Inga restock-watch-källor flaggade.");
    return { sources: 0, itemsUpdated: 0, alertsSent: 0 };
  }

  let itemsUpdated = 0;
  for (const s of watch) {
    try {
      const summary = await runScrapeJob(s.id);
      itemsUpdated += summary.itemsUpdated;
      console.log(`[restock-watch] ${s.name}: ${summary.itemsFound} hittade, ${summary.itemsUpdated} uppdaterade.`);
    } catch (err) {
      console.error(`[restock-watch] ${s.name} misslyckades:`, err instanceof Error ? err.message : err);
    }
  }

  const alerts = await dispatchPendingAlerts();
  console.log(`[restock-watch] Klart: ${watch.length} källor, ${itemsUpdated} uppdaterade, ${alerts.sent} alerts skickade.`);
  return { sources: watch.length, itemsUpdated, alertsSent: alerts.sent };
}
