/**
 * PRISLARMENS SVEP ÖVER BEVAKADE PRODUKTER (2026-09-06).
 *
 * Prisjobben (nattkedjan, cardmarket-refresh 13:00, hot-card 21:00) skriver tusentals
 * offer-priser; prislarmen bryr sig bara om de ~50 produkter någon faktiskt bevakar
 * med prislarm. I stället för en dom per offer-rörelse i hela katalogen (defekt 5:
 * bara butiksfeedarnas offer-diff nådde `checkPriceAlerts`, så ett äkta CM-prisfall
 * på en singel larmade aldrig) tar jobbet en ögonblicksbild av de bevakade
 * produkternas lägsta köpbara pris FÖRE, gör sitt jobb, och sveper EFTER: de som blivit
 * billigare (eller fått ett köpbart pris) går till `checkPriceAlerts`, med "före"-priset
 * som prisfall-lägets utgångsläge.
 *
 * Kostnad: två frågor + en per produkt som faktiskt blev billigare. Bevakningar som
 * tillkommit UNDER jobbet saknar "före" och får `previousOre = null`: målpris-läget
 * larmar om målet är nått (det är ett faktum), prisfall-läget avstår (inget utgångsläge).
 *
 * ⛔ PAUSAT LÄGE kostar noll: båda funktionerna returnerar tomt utan en enda fråga.
 */
import { prisma } from "@/lib/db";
import { proUserWhere } from "@/lib/plan";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { checkPriceAlerts, lowestBuyableByProduct } from "@/services/alerts";

export type WatchedPriceSnapshot = Map<string, number | null>;

async function watchedProductIds(): Promise<string[]> {
  const rows = await prisma.watchlistItem.findMany({
    where: { priceAlert: true, isPaused: false, user: proUserWhere() },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.map((r) => r.productId);
}

/** Lägsta köpbara pris (öre, eller null) per bevakad produkt — ta FÖRE prisjobbet. */
export async function snapshotWatchedPrices(): Promise<WatchedPriceSnapshot> {
  const snap: WatchedPriceSnapshot = new Map();
  if (priceAlertsPaused()) return snap;
  const ids = await watchedProductIds();
  const lowest = await lowestBuyableByProduct(ids);
  for (const id of ids) snap.set(id, lowest.get(id)?.price ?? null);
  return snap;
}

export interface PriceAlertSweepResult {
  /** Bevakade produkter som svepet såg. */
  products: number;
  /** Produkter som blivit billigare (eller köpbara) och därför dömdes. */
  checked: number;
  /** Larmrader skapade. */
  triggered: number;
  skipped: Record<string, number>;
}

/** Svep EFTER prisjobbet (och efter `recomputeProductPriceCache` + `rearmPriceAlerts`). */
export async function sweepWatchedPriceAlerts(before: WatchedPriceSnapshot): Promise<PriceAlertSweepResult> {
  const result: PriceAlertSweepResult = { products: 0, checked: 0, triggered: 0, skipped: {} };
  if (priceAlertsPaused()) return result;
  const ids = await watchedProductIds();
  result.products = ids.length;
  const after = await lowestBuyableByProduct(ids);
  for (const id of ids) {
    const lowest = after.get(id) ?? null;
    if (!lowest) continue; // inget köpbart pris → inget att larma om
    const prev = before.has(id) ? (before.get(id) ?? null) : null;
    // Bara när något kan ha blivit billigare: ett nytt köpbart pris, eller ett lägre.
    if (prev != null && lowest.price >= prev) continue;
    result.checked++;
    const r = await checkPriceAlerts(id, { previousOre: prev, lowest });
    result.triggered += r.triggered;
    for (const [k, v] of Object.entries(r.skipped)) result.skipped[k] = (result.skipped[k] ?? 0) + v;
  }
  return result;
}

export function formatSweep(r: PriceAlertSweepResult): string {
  const skipped = Object.entries(r.skipped)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return (
    `${r.products} bevakade produkter, ${r.checked} billigare → ${r.triggered} prislarm` +
    `${skipped ? ` (hoppade: ${skipped})` : ""}`
  );
}
