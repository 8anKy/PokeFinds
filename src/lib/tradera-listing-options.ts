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

/**
 * Momssatser en svensk säljare kan välja. 25 % är normalsatsen och den som
 * gäller samlarkort; 12/6 finns för den som säljer något annat i samma flöde.
 *
 * ⛔ VALFRITT MED FLIT. En privatperson som säljer ur sin egen samling redovisar
 * INGEN moms, och ett fält som står ifyllt som standard hade fått folk att
 * påstå något om sin försäljning som inte stämmer. Av = inget `vat` alls
 * skickas till Tradera.
 */
export const VAT_RATES = [25, 12, 6] as const;
export const DEFAULT_VAT_RATE = 25;

/**
 * Momsen SOM REDAN LIGGER I PRISET, i hela kronor. Priser till konsument anges
 * inklusive moms i Sverige — beloppet räknas alltså BAKLÄNGES ur priset
 * (pris × sats/(100+sats)), aldrig som ett påslag ovanpå.
 */
export function vatShareKr(priceKr: number, ratePercent: number): number {
  if (!Number.isFinite(priceKr) || priceKr <= 0 || ratePercent <= 0) return 0;
  return Math.round((priceKr * ratePercent) / (100 + ratePercent));
}

/** Billigaste fraktsättet av dem säljaren valt — det köparen minst kan betala. */
export function cheapestShippingKr(costs: readonly number[]): number {
  const valid = costs.filter((c) => Number.isFinite(c) && c >= 0);
  return valid.length === 0 ? 0 : Math.min(...valid);
}

/**
 * Paketstorlekar säljaren kan välja, i METER (samma enhet som Traderas
 * `packageRequirements`). Talen är inte påhittade: de tre är precis de format
 * Traderas egna fraktprodukter är byggda kring — brev/A4-formatet, skokartongen
 * och den långa lådan.
 *
 * Storleken skickas ALDRIG till Tradera (fraktraden bär bara vikt) — den
 * FILTRERAR vilka fraktsätt som ens går att välja, så att man inte köper en
 * 22-kronorsfrakt till en boosterbox som aldrig får plats i den.
 */
export const PACKAGE_SIZES = {
  SMALL: { length: 0.34, width: 0.24, height: 0.07 },
  MEDIUM: { length: 0.6, width: 0.4, height: 0.2 },
  LARGE: { length: 1.2, width: 0.4, height: 0.4 },
} as const;

export type PackageSize = keyof typeof PACKAGE_SIZES;
export const PACKAGE_SIZE_KEYS = ["SMALL", "MEDIUM", "LARGE"] as const;
export const DEFAULT_PACKAGE_SIZE: PackageSize = "SMALL";

/** "34 × 24 × 7 cm" — meter → centimeter, som folk mäter paket. */
export function packageSizeLabel(size: PackageSize): string {
  const d = PACKAGE_SIZES[size];
  const cm = (m: number) => Math.round(m * 100);
  return `${cm(d.length)} × ${cm(d.width)} × ${cm(d.height)} cm`;
}
