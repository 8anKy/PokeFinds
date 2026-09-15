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
import { GRADED_ASK_MAX_AGE_DAYS } from "../lib/graded-ask";

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

/**
 * BEGÄRT PRIS — vad någon vill ha just nu, per (källa, bolag, betyg).
 * ⛔ Aldrig samma rad som en affär. Källan följer med ut ("eBay"), liksom
 * antalet annonser och länken — det är ett erbjudande, inte ett marknadspris.
 */
export interface GradedAskRow {
  source: string;
  issuer: GradingIssuer;
  gradeTenths: number;
  /** Lägsta begärda pris, öre (konverterat). */
  priceOre: number;
  originalMinor: number;
  originalCurrency: string;
  listingCount: number;
  url: string;
  observedAt: string;
}

/**
 * GRADERAD PRISHISTORIK per (bolag, betyg) — det grafen ritar när besökaren
 * väljer en gradering i karusellen. `asks` = lägsta begärda per dygn ur
 * GradedAskSnapshot (byggs framåt sedan 2026-09-15), `sold` = varje Tradera-
 * affär som en punkt. ⛔ Två serier, aldrig en — begärt är inte sålt.
 */
export interface GradedHistory {
  issuer: GradingIssuer;
  gradeTenths: number;
  asks: { date: string; price: number }[];
  sold: { date: string; price: number }[];
}

export interface GradedSummary {
  windowDays: number;
  totalSales: number;
  rows: GradedSaleRow[];
  /** Aktiva begärda priser (tom lista när inget svepts eller allt är för gammalt). */
  asks: GradedAskRow[];
  /** Historik per (bolag, betyg) — bara grupper som har minst en punkt. */
  history: GradedHistory[];
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

function sortByIssuerThenGrade<T extends { issuer: GradingIssuer; gradeTenths: number | null }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const ai = ISSUER_ORDER.indexOf(a.issuer);
    const bi = ISSUER_ORDER.indexOf(b.issuer);
    if (ai !== bi) return ai - bi;
    // Högsta betyg först — det är raden folk letar efter. Okänt betyg sist.
    return (b.gradeTenths ?? -1) - (a.gradeTenths ?? -1);
  });
}

export async function getGradedSummary(productId: string): Promise<GradedSummary> {
  const cutoff = new Date(Date.now() - GRADED_WINDOW_DAYS * 86_400_000);
  // Begärda priser är ett TILLSTÅND — en rad äldre än rotationens fönster är en
  // annons vi inte vet om den finns kvar, och visas då inte.
  const askCutoff = new Date(Date.now() - GRADED_ASK_MAX_AGE_DAYS * 86_400_000);
  const [sales, snapshots, askRows] = await Promise.all([
    prisma.gradedSale.findMany({
      where: { productId, soldAt: { gte: cutoff } },
      orderBy: { soldAt: "desc" },
      select: { issuer: true, gradeTenths: true, price: true, soldAt: true, url: true },
    }),
    // Historiken: ett år bakåt (samma fönster som sålt), dygnspunkter per grupp.
    prisma.gradedAskSnapshot.findMany({
      where: { productId, date: { gte: cutoff } },
      orderBy: { date: "asc" },
      select: { issuer: true, gradeTenths: true, date: true, priceOre: true },
    }),
    prisma.gradedAsk.findMany({
      where: { productId, observedAt: { gte: askCutoff } },
      select: {
        source: true, issuer: true, gradeTenths: true, priceOre: true, originalMinor: true,
        originalCurrency: true, listingCount: true, url: true, observedAt: true,
      },
    }),
  ]);
  const asks: GradedAskRow[] = sortByIssuerThenGrade(
    askRows.map((a) => ({
      source: a.source,
      issuer: a.issuer as GradingIssuer,
      gradeTenths: a.gradeTenths,
      priceOre: a.priceOre,
      originalMinor: a.originalMinor,
      originalCurrency: a.originalCurrency,
      listingCount: a.listingCount,
      url: a.url,
      observedAt: a.observedAt.toISOString(),
    }))
  );

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

  sortByIssuerThenGrade(rows);

  // Historik per (bolag, betyg): begärt-punkter ur snapshotarna, sålt-punkter ur
  // affärerna. Sålt med okänt betyg har ingen grupp att hamna i och utelämnas.
  const hist = new Map<string, GradedHistory>();
  const histFor = (issuer: GradingIssuer, gradeTenths: number) => {
    const key = `${issuer}|${gradeTenths}`;
    let h = hist.get(key);
    if (!h) hist.set(key, (h = { issuer, gradeTenths, asks: [], sold: [] }));
    return h;
  };
  for (const s of snapshots) {
    histFor(s.issuer as GradingIssuer, s.gradeTenths).asks.push({
      date: s.date.toISOString().slice(0, 10),
      price: s.priceOre,
    });
  }
  for (const s of sales) {
    if (s.gradeTenths == null) continue;
    histFor(s.issuer as GradingIssuer, s.gradeTenths).sold.push({
      date: s.soldAt.toISOString().slice(0, 10),
      price: s.price,
    });
  }
  const history = [...hist.values()];
  for (const h of history) h.sold.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  sortByIssuerThenGrade(history);

  return { windowDays: GRADED_WINDOW_DAYS, totalSales: sales.length, rows, asks, history };
}
