/**
 * GRADERADE FÖRSÄLJNINGAR — läsmodellen bakom "Graderat"-blocket på produktsidan.
 *
 * ⛔ EN RAD PER (BOLAG, BETYG), ALDRIG ETT SNITT ÖVER ALLA BETYG. En PSA 10 och en
 * PSA 6 av samma kort är inte samma vara, och ett medelvärde över dem beskriver
 * ingen affär som någonsin ägt rum. Samma regel som håller isär tryckningar.
 *
 * ⛔ `n` FÖLJER ALLTID MED UT. Underlaget är tunt av naturen: kategorin avslutar
 * ~128 annonser/dygn för HELA Sverige (mätt 2026-09-04) mot ~20 000 singlar i
 * katalogen, så de flesta kort landar på 0–2 affärer. Ett medianpris utan sitt
 * urval låtsas vara en marknad. Klienten MÅSTE visa talet.
 *
 * ⛔ MEDIAN, INTE MEDELVÄRDE. Ett enda felmatchat lotpris drar ett medelvärde hur
 * långt som helst; medianen tål det.
 */
import { prisma } from "../lib/db";
import type { GradingIssuer } from "../lib/graded-listing";

/** Hur långt bak blocket räknar. Serien byggs FRAMÅT — den börjar tom. */
export const GRADED_WINDOW_DAYS = 365;

export interface GradedSaleRow {
  issuer: GradingIssuer;
  /** Betyg × 10 (100 = 10,0). null = graderat kort med okänt betyg → visas "–". */
  gradeTenths: number | null;
  /** Antal affärer i fönstret. Visas ALLTID bredvid priset. */
  count: number;
  medianOre: number;
  lowOre: number;
  highOre: number;
  /** Senaste affären i gruppen. */
  lastPriceOre: number;
  lastSoldAt: string;
  lastUrl: string;
}

export interface GradedSummary {
  windowDays: number;
  totalSales: number;
  rows: GradedSaleRow[];
}

function medianOre(sorted: number[]): number {
  const i = sorted.length >> 1;
  return sorted.length % 2 ? sorted[i] : Math.round((sorted[i - 1] + sorted[i]) / 2);
}

/**
 * Bolagens ordning i blocket. Inte alfabetisk och inte efter antal — läsaren
 * letar efter sitt eget bolag, och de stora ska ligga överst (PSA ensamt = 50 %
 * av kategorin, mätt). `OTHER` sist: det är en restpost, inte ett bolag.
 */
const ISSUER_ORDER: GradingIssuer[] = [
  "PSA", "BGS", "CGC", "SGC", "ACE", "RAUKCARD", "TAG", "HGA", "GMA", "ISA", "AGS", "GG", "OTHER",
];

export async function getGradedSummary(productId: string): Promise<GradedSummary> {
  const cutoff = new Date(Date.now() - GRADED_WINDOW_DAYS * 86_400_000);
  const sales = await prisma.gradedSale.findMany({
    where: { productId, soldAt: { gte: cutoff } },
    orderBy: { soldAt: "desc" },
    select: { issuer: true, gradeTenths: true, price: true, soldAt: true, url: true },
  });

  const groups = new Map<string, typeof sales>();
  for (const s of sales) {
    // ⛔ null måste ha en EGEN nyckel — "okänt betyg" får inte klumpas med betyg 0
    // (som inte finns) eller smyga in i en riktig betygsgrupp.
    const key = `${s.issuer}|${s.gradeTenths ?? "?"}`;
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const rows: GradedSaleRow[] = [];
  for (const arr of groups.values()) {
    const prices = arr.map((s) => s.price).sort((a, b) => a - b);
    // Sorteringen ovan är på PRIS; senaste affären är arr[0] (soldAt desc).
    const last = arr[0];
    rows.push({
      issuer: last.issuer as GradingIssuer,
      gradeTenths: last.gradeTenths,
      count: arr.length,
      medianOre: medianOre(prices),
      lowOre: prices[0],
      highOre: prices[prices.length - 1],
      lastPriceOre: last.price,
      lastSoldAt: last.soldAt.toISOString(),
      lastUrl: last.url,
    });
  }

  rows.sort((a, b) => {
    const ai = ISSUER_ORDER.indexOf(a.issuer);
    const bi = ISSUER_ORDER.indexOf(b.issuer);
    if (ai !== bi) return ai - bi;
    // Högsta betyg först — det är raden folk letar efter. Okänt betyg sist.
    return (b.gradeTenths ?? -1) - (a.gradeTenths ?? -1);
  });

  return { windowDays: GRADED_WINDOW_DAYS, totalSales: sales.length, rows };
}
