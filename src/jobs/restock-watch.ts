/**
 * Restock-bevakning: lätt skanning av ALLA sealed-produkter som de restock-
 * bevakade butikerna (config.restockWatch=true) aktivt säljer. Delegerar till
 * runRestockScan i runnern (parallell katalog-hämtning + DB-diff per URL, inga
 * pris-/observationsskrivningar → billigt nog för timvis körning inom Neon free-tier).
 *
 * Körs av GitHub Actions (`restock-watch` var timme) + ev. BullMQ-worker/instrumentation.
 * Den fulla pris-/katalog-insamlingen ligger kvar i scrape-all (dagligen).
 */
import { runRestockScan } from "../scrapers/runner";

export interface RestockWatchResult {
  sources: number;
  itemsUpdated: number;
  alertsSent: number;
}

export async function runRestockWatch(): Promise<RestockWatchResult> {
  const r = await runRestockScan();
  return { sources: r.sources, itemsUpdated: r.checked, alertsSent: r.alertsSent };
}
