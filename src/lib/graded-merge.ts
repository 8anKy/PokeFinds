/**
 * Graderade priser per (bolag, betyg) — REN sammanslagning av tre listor ur
 * `GradedSummary` (begärt/eBay, sålt/Tradera, historik) till det karusellen
 * ritar. Utan React/DB så att domen kan testas: varje bolag med data, betygen
 * fallande, "–" där ena källan saknas (aldrig ett lånat tal).
 */
import type { GradingIssuer } from "@/lib/graded-listing";
import type { GradedAskRow, GradedHistory, GradedSaleRow } from "@/services/graded";

export interface GradedGradeCell {
  gradeTenths: number;
  ask: GradedAskRow | null;
  /** Sålt på Tradera. */
  sale: GradedSaleRow | null;
  /** Sålt på eBay UK (leverantören). Egen cell — aldrig blandad med Tradera. */
  saleEbay: GradedSaleRow | null;
  history: GradedHistory | null;
}

export interface GradedIssuerCard {
  issuer: GradingIssuer;
  /** Fallande betyg. Bara betyg som har minst en källa. */
  grades: GradedGradeCell[];
}

export const ISSUER_ORDER: GradingIssuer[] = [
  "PSA", "BGS", "CGC", "SGC", "ACE", "RAUKCARD", "TAG", "HGA", "GMA", "ISA", "AGS", "GG", "OTHER",
];

export function buildGradedCards(
  asks: GradedAskRow[],
  sales: GradedSaleRow[],
  history: GradedHistory[]
): GradedIssuerCard[] {
  const byIssuer = new Map<GradingIssuer, Map<number, GradedGradeCell>>();
  const cell = (issuer: GradingIssuer, gradeTenths: number) => {
    let grades = byIssuer.get(issuer);
    if (!grades) byIssuer.set(issuer, (grades = new Map()));
    let c = grades.get(gradeTenths);
    if (!c) grades.set(gradeTenths, (c = { gradeTenths, ask: null, sale: null, saleEbay: null, history: null }));
    return c;
  };
  for (const a of asks) cell(a.issuer, a.gradeTenths).ask = a;
  // ⛔ Sålt med okänt betyg (null) har ingen cell — karusellen väljer per betyg.
  for (const s of sales) {
    if (s.gradeTenths == null) continue;
    const c = cell(s.issuer, s.gradeTenths);
    if (s.source === "ebay") c.saleEbay = s;
    else c.sale = s;
  }
  for (const h of history) cell(h.issuer, h.gradeTenths).history = h;
  // ⛔ "ANNAT BOLAG" VISAS INTE (ägarbeslut 2026-10-12). OTHER = graderat men bolaget går
  // inte att fastställa ("Gem Mint 10", okända småbolag, lotter med flera bolag) — ett
  // sådant 10 är inte jämförbart med PSA/ACE 10, och på Gengar ex 30th 154 var chippet
  // EN eBay-annons à 4 524 kr. Raderna ligger kvar i databasen; bara visningen fäller dem.
  byIssuer.delete("OTHER");
  return [...byIssuer.entries()]
    .sort(([a], [b]) => ISSUER_ORDER.indexOf(a) - ISSUER_ORDER.indexOf(b))
    .map(([issuer, grades]) => ({
      issuer,
      grades: [...grades.values()].sort((a, b) => b.gradeTenths - a.gradeTenths),
    }));
}

/**
 * Cellens SÅLDA pris — det badgen visar (ägarbeslut 2026-10-15: "sålt i bolagets ruta,
 * inte begärt"). eBay först, Tradera som reserv, aldrig blandat — samma ordning som
 * samlingens slabvärde (`lib/graded-value.ts`). null = inga affärer för betyget.
 */
export function cellSold(cell: GradedGradeCell): GradedSaleRow | null {
  return cell.saleEbay ?? cell.sale;
}

/**
 * Kortets förvalda betyg: högsta med SÅLDA affärer, annars högsta med ett begärt
 * pris, annars högsta alls. (Före 2026-10-15: begärt först — en ensam eBay-annons à
 * 729 857 kr för PSA 9 blev bolagets rubriktal på Gardevoir LV.X.)
 */
export function defaultGrade(card: GradedIssuerCard): number {
  return (card.grades.find((g) => cellSold(g)) ?? card.grades.find((g) => g.ask) ?? card.grades[0]).gradeTenths;
}
