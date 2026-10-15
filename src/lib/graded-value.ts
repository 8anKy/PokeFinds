/**
 * VÄRDET PÅ EN GRADERAD POST — BARA SÅLT (ägarbeslut 2026-10-15).
 *
 * En slab värderas på vad samma (kort, bolag, betyg) faktiskt SÅLTS för, aldrig
 * på vad någon begär: eBay-annonsernas lägsta begärda pris ligger nästan alltid
 * över affärerna, och en samling värderad på säljarnas önskemål är en uppblåst
 * samling. Begärt visas på produktsidan, med etikett — det räknas aldrig hit.
 *
 * ⛔ EN KÄLLA ÅT GÅNGEN, ALDRIG BLANDAD. eBay sålt (UK, GBP → öre) först, Tradera
 *    sålt som reserv. Samma regel som `getGradedSummary`: två marknader i en
 *    median beskriver ingen affär som ägt rum.
 * ⛔ MEDIAN AV DE SENASTE, inte av hela året. Ett värde ska följa marknaden, och
 *    ett års medianpris på ett kort som rört sig är ett historiskt tal. Medianen
 *    (inte snittet) tål ett enstaka felmatchat lotpris.
 * ⛔ INGA AFFÄRER ⇒ null. Anroparen faller då tillbaka på det OGRADERADE värdet
 *    och säger det rakt ut — aldrig ett lånat tal från ett annat betyg eller bolag.
 *
 * REN — testad i `graded-value.test.ts`.
 */
import type { Prisma } from "@prisma/client";

/** Hur långt bak en affär får ligga för att räknas. Samma fönster som produktsidan. */
export const GRADED_VALUE_WINDOW_DAYS = 365;
/** Medianen tas över så här många av de SENASTE affärerna i den valda källan. */
export const GRADED_VALUE_RECENT_SALES = 5;

export type GradedValueSource = "ebay" | "tradera";

export interface GradedSalePoint {
  source: string;
  /** öre, > 0 */
  price: number;
  soldAt: Date | string;
}

export interface GradedValue {
  /** öre per styck */
  valueOre: number;
  source: GradedValueSource;
  /** Antal affärer medianen bygger på (≤ GRADED_VALUE_RECENT_SALES). */
  count: number;
  /** Senaste affären (ISO). */
  lastSoldAt: string;
}

/**
 * Vad en GRADERAD samlingspost värderades på: affärerna (`source` + `count`), eller
 * `null` = inga affärer ännu ⇒ posten bär sitt OGRADERADE värde, och UI:t säger det.
 */
export type ItemGradedValue = Pick<GradedValue, "source" | "count"> | null;

/** Källornas ordning — första som har en affär i fönstret vinner. */
const SOURCE_ORDER: GradedValueSource[] = ["ebay", "tradera"];

function median(sorted: number[]): number {
  const i = sorted.length >> 1;
  return sorted.length % 2 ? sorted[i] : Math.round((sorted[i - 1] + sorted[i]) / 2);
}

/**
 * Värdet ur affärerna för EN (produkt, bolag, betyg). Anroparen har redan filtrerat
 * på nyckeln; den här funktionen väljer källa, fönster och median.
 */
export function gradedSoldValue(sales: readonly GradedSalePoint[], now: Date = new Date()): GradedValue | null {
  const cutoff = now.getTime() - GRADED_VALUE_WINDOW_DAYS * 86_400_000;
  const recent = sales
    .map((s) => ({ ...s, t: new Date(s.soldAt).getTime() }))
    .filter((s) => s.price > 0 && Number.isFinite(s.t) && s.t >= cutoff && s.t <= now.getTime() + 86_400_000);
  for (const source of SOURCE_ORDER) {
    const mine = recent.filter((s) => s.source === source).sort((a, b) => b.t - a.t);
    if (mine.length === 0) continue;
    const latest = mine.slice(0, GRADED_VALUE_RECENT_SALES);
    return {
      valueOre: median(latest.map((s) => s.price).sort((a, b) => a - b)),
      source,
      count: latest.length,
      lastSoldAt: new Date(latest[0].t).toISOString(),
    };
  }
  return null;
}

/** Nyckeln värdena lagras under: produkt + bolag + betyg. */
export function gradedValueKey(productId: string, issuer: string, gradeTenths: number): string {
  return `${productId}|${issuer}|${gradeTenths}`;
}

/**
 * Produkter som NÅGON äger en graderad post av — direkt (`productId`) eller via
 * kortet (poster som bara bär `cardId`). De graderade svepen tar dem VARJE natt
 * bredvid bevakade kort, så att en slab i en samling inte väntar på rotationen
 * (~en vecka) för att få sina affärer. Mätt 2026-10-15: 8 produkter.
 */
export const OWNED_GRADED_PRODUCT_WHERE: Prisma.ProductWhereInput[] = [
  { collectionItems: { some: { gradingCompany: { not: null }, grade: { not: null } } } },
  {
    card: {
      collectionItems: { some: { productId: null, gradingCompany: { not: null }, grade: { not: null } } },
    },
  },
];
