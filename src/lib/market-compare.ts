/**
 * MARKNADSVÄRDE + TRADERA SÅLT I DISCORD-INLÄGGEN — ren modul, ingen DB
 * (ägarbeslut 2026-10-10, ersätter "Rek. pris").
 *
 * Rek. pris (MSRP) är BORTTAGET: ingen produkt hade någonsin fått ett satt, och det
 * finns ingen publik svensk källa att fylla det ur. Jämförelsepunkten är i stället
 * Cardmarket-värdet — samma nattligt frysta tal som samlingsvärdet
 * (`Product.settledValue*`, src/lib/market-value.ts) — och det säljs som
 * "Marknadsvärde" i inlägget.
 *
 * ⛔ BARA ETT CARDMARKET-VÄRDE ÄR ETT MARKNADSVÄRDE. `settledValueFromCm: false` är
 *    reserven (lägsta butik/marknadsplats) — att jämföra en butik mot den billigaste
 *    butiken och kalla det marknaden hade varit ett påstående vi inte kan belägga.
 *    Exporten skickar därför null för icke-CM-värden (scripts/lib/restock-routes.ts).
 * ⛔ RÖR ALDRIG PRISET. Jämförelsen är text + kantfärg i ett Discord-inlägg; rubrikpris,
 *    "Lägst", statistik och larm räknas som förut.
 */
import { formatPrice } from "@/lib/format";

/** Färre försäljningar än så ⇒ ingen Tradera-rad. En enda affär är en anekdot. */
export const TRADERA_SOLD_MIN_COUNT = 3;
/** Fönstret försäljningarna räknas över. */
export const TRADERA_SOLD_WINDOW_DAYS = 30;

export interface MarketDelta {
  /** Marknadsvärdet (Cardmarket) i öre. */
  marketOre: number;
  /** Det vi jämför: butikens pris + frakten när den är känd. */
  totalOre: number;
  /** true = frakten ingår i `totalOre`. */
  withShipping: boolean;
  /** (total − marknad) / marknad i procent. Negativt = under marknadsvärdet. */
  percent: number;
  /** "good" = på eller under marknadsvärdet, "bad" = över. */
  verdict: "good" | "bad";
}

/**
 * Butikens pris (+ frakt) mot marknadsvärdet. null när något av talen inte är ett
 * riktigt pris — 0 kr är inget pris, och en nolla i nämnaren hade gett "Infinity %"
 * i en publik kanal.
 *
 * Frakten läggs på BARA butikssidan: Cardmarkets frakt beror på säljare och land och
 * finns inte i vår data. Jämförelsen underskattar alltså rabatten — den ärliga riktningen.
 */
export function marketDelta(
  priceOre: number | null | undefined,
  marketOre: number | null | undefined,
  shippingOre?: number | null
): MarketDelta | null {
  if (priceOre == null || marketOre == null || priceOre <= 0 || marketOre <= 0) return null;
  const withShipping = typeof shippingOre === "number" && shippingOre > 0;
  const totalOre = priceOre + (withShipping ? (shippingOre as number) : 0);
  const percent = ((totalOre - marketOre) / marketOre) * 100;
  return { marketOre, totalOre, withShipping, percent, verdict: totalOre <= marketOre ? "good" : "bad" };
}

/**
 * "1 130 kr · 🟢 22 % under" / "999 kr · 🔴 8 % över" / "🟢 samma pris".
 *
 * Discord kan inte färga löptext i ett embed, så domen bärs av emojin (mobilen visar
 * kanten smalt) OCH av kantfärgen. Hela procent: en decimal i ett lopp är brus.
 */
export function formatMarketValue(delta: MarketDelta): string {
  const rounded = Math.round(Math.abs(delta.percent));
  const dot = delta.verdict === "good" ? "🟢" : "🔴";
  const verdict =
    rounded === 0 ? "samma pris" : `${rounded} % ${delta.percent < 0 ? "under" : "över"}`;
  return `${formatPrice(delta.marketOre)} · ${dot} ${verdict}${delta.withShipping ? " (inkl. frakt)" : ""}`;
}

/**
 * "1 050 kr · median av 6 sålda, 30 d". null under `TRADERA_SOLD_MIN_COUNT` affärer
 * eller utan riktigt pris — hellre ingen rad än ett tal byggt på en auktion.
 *
 * MEDIAN, inte snitt, och det står ut: samma storhet som prisgrafens sålt-serie
 * (`bucketObservationsBySource`), och den tål den udda auktionen som gick för en krona.
 */
export function formatTraderaSold(
  medianOre: number | null | undefined,
  count: number | null | undefined
): string | null {
  if (medianOre == null || medianOre <= 0 || count == null || count < TRADERA_SOLD_MIN_COUNT) return null;
  return `${formatPrice(medianOre)} · median av ${count} sålda, ${TRADERA_SOLD_WINDOW_DAYS} d`;
}
