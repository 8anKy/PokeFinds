/**
 * Valen i "Sälj på Tradera"-arket — REN modul (ingen Prisma, ingen Next, ingen
 * fetch) så att API-rutten, klienten och testerna delar exakt samma dom.
 *
 * ⛔ SKICK ÄR INTE SAMMA FRÅGA FÖR ETT KORT OCH FÖR EN FÖRSEGLAD PRODUKT.
 * "Near Mint" på en boosterbox är meningslöst — den är förseglad eller öppnad.
 * Två listor, en per varutyp, och båda lagrar `CardCondition`-NYCKELN (aldrig
 * etiketten) eftersom samlingen och forumet redan gör det.
 */

export type ListingType = "BUY_NOW" | "AUCTION";

/** Tradera item-typ: 1 = Auktion, 3 = Endast Köp Nu (GET /v4/reference-data/item-types). */
export const ITEM_TYPE_AUCTION = 1;
export const ITEM_TYPE_BUY_NOW = 3;

/** Köp nu-annonsens löptid. 60 dagar = längsta Tradera tillåter. */
export const BUY_NOW_DURATION_DAYS = 60;
/** Auktionens löptid i dagar — Traderas egna val i säljformuläret. */
export const AUCTION_DURATIONS = [3, 5, 7, 10, 14] as const;
export const DEFAULT_AUCTION_DURATION = 7;

/** Skick för ett LÖST kort. Samma nycklar som `CardCondition` i schemat. */
export const SINGLE_CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "EXCELLENT",
  "GOOD",
  "PLAYED",
  "POOR",
] as const;

/**
 * Skick för en FÖRSEGLAD produkt. Tre lägen som en köpare faktiskt kan skilja
 * på; enum-nycklarna återanvänds så att inget nytt behöver migreras.
 */
export const SEALED_CONDITIONS = ["SEALED", "NEAR_MINT", "GOOD"] as const;

export function conditionOptionsFor(isSingle: boolean): readonly string[] {
  return isSingle ? SINGLE_CONDITIONS : SEALED_CONDITIONS;
}

/**
 * Etiketten som hamnar i Tradera-annonsens rubrik och beskrivning. Sealed har
 * EGNA texter — samma nyckel betyder olika saker för de två varutyperna.
 */
const SINGLE_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Förseglad",
};

const SEALED_LABELS: Record<string, string> = {
  SEALED: "Förseglad",
  NEAR_MINT: "Öppnad, som ny",
  GOOD: "Öppnad, använd",
};

export function conditionLabel(condition: string, isSingle: boolean): string {
  const table = isSingle ? SINGLE_LABELS : SEALED_LABELS;
  return table[condition] ?? SINGLE_LABELS[condition] ?? condition;
}

/**
 * AI-graderingens helhetsgrad (1–10) → ett skick att förifylla med.
 *
 * ⛔ FÖRSLAG, ALDRIG ETT PÅSTÅENDE. Graden är vår modells bedömning av två
 * foton, inte en PSA-slab, och den skrivs därför bara in i väljaren — köparen
 * ser skicket säljaren till slut valde, inte vad modellen gissade.
 */
export function gradeToCondition(overall: number): string {
  if (!Number.isFinite(overall)) return "NEAR_MINT";
  if (overall >= 9.5) return "MINT";
  if (overall >= 8.5) return "NEAR_MINT";
  if (overall >= 7) return "EXCELLENT";
  if (overall >= 5) return "GOOD";
  if (overall >= 3) return "PLAYED";
  return "POOR";
}

/** Snabbvalen kring priset. 0 = "tillbaka till marknadspriset". */
export const PRICE_STEPS = [-10, -5, 0, 5, 10, 20] as const;

/** Basen ±procent, aldrig under 1 kr (Tradera tar inga nollannonser). */
export function applyPricePercent(baseKr: number, pct: number): number {
  return Math.max(1, Math.round((baseKr * (100 + pct)) / 100));
}

/** Det köparen faktiskt betalar: pris + frakt. Ogiltiga tal räknas som 0. */
export function totalBuyerKr(priceKr: number, shippingKr: number): number {
  const p = Number.isFinite(priceKr) && priceKr > 0 ? Math.round(priceKr) : 0;
  const s = Number.isFinite(shippingKr) && shippingKr > 0 ? Math.round(shippingKr) : 0;
  return p + s;
}
