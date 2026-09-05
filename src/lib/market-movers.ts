/**
 * MARKNADENS "STÖRSTA RÖRELSER" — den rena domen.
 *
 * ⛔ FÖRSTA-MOT-SISTA VAR EN GLITCHDETEKTOR, INTE EN TRENDLISTA (2026-09-05).
 * Listan jämförde dygnsvärdet första och sista dagen i fönstret. På /marknad
 * stod då Gallade POP Series 7 på +9 032 % (60,77 → 5 550 kr), Wooper Aquapolis
 * på 99 911 kr och Undaunted Booster Box på −87,7 % från 496 350 kr — alla
 * enstaka dagar där Cardmarkets "From" hoppade för att den enda billiga annonsen
 * såldes (eller en absurd dök upp). Riktiga tal, men inte marknadsrörelser.
 *
 * Nu: MEDIANEN av fönstrets första halva mot medianen av den sista. En ensam
 * glitchdag kan inte längre avgöra vare sig start eller slut, och det krävs
 * minst tre punkter. Dessutom ett rimlighetstak: mer än ×4 (eller under ÷4) på
 * en vecka för en vara över 10 kr är inte en trend utan en datahändelse — den
 * ska synas på produktsidan (råa priser rör vi inte, se
 * project_price_outlier_guard_decision), men inte toppa /marknad.
 *
 * ⛔ Detta är ett VISNINGSFILTER. Inget skrivs, ingen observation kastas.
 */

/** Golv: 10 kr. Endagssnitt för bulk-kort är brus (en försäljning à €0,02 ⇒ ±6000 %). */
export const MOVER_MIN_PRICE_ORE = 1000;
/** Största trovärdiga veckorörelse i endera riktningen (×4 / ÷4). */
export const MOVER_MAX_RATIO = 4;
/** Minsta antal dygnspunkter för att alls bedöma en rörelse. */
export const MOVER_MIN_POINTS = 3;

export interface MoveSummary {
  firstPrice: number;
  lastPrice: number;
  change: number;
  changePercent: number;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Sammanfattar en produkts dygnspriser (kronologisk ordning, i öre) till en
 * rörelse — eller null när den inte ska räknas som en.
 */
export function summarizeMove(pricesChronological: number[]): MoveSummary | null {
  const prices = pricesChronological.filter((p) => Number.isFinite(p));
  const n = prices.length;
  if (n < MOVER_MIN_POINTS) return null;
  const half = Math.ceil(n / 2);
  const firstPrice = median(prices.slice(0, half));
  const lastPrice = median(prices.slice(n - half));
  if (firstPrice < MOVER_MIN_PRICE_ORE || lastPrice < MOVER_MIN_PRICE_ORE) return null;
  const ratio = lastPrice / firstPrice;
  if (ratio > MOVER_MAX_RATIO || ratio < 1 / MOVER_MAX_RATIO) return null;
  const change = lastPrice - firstPrice;
  return {
    firstPrice,
    lastPrice,
    change,
    changePercent: Math.round((change / firstPrice) * 10000) / 100,
  };
}
