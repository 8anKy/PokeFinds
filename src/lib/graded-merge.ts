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
  sale: GradedSaleRow | null;
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
    if (!c) grades.set(gradeTenths, (c = { gradeTenths, ask: null, sale: null, history: null }));
    return c;
  };
  for (const a of asks) cell(a.issuer, a.gradeTenths).ask = a;
  // ⛔ Sålt med okänt betyg (null) har ingen cell — karusellen väljer per betyg.
  for (const s of sales) if (s.gradeTenths != null) cell(s.issuer, s.gradeTenths).sale = s;
  for (const h of history) cell(h.issuer, h.gradeTenths).history = h;
  return [...byIssuer.entries()]
    .sort(([a], [b]) => ISSUER_ORDER.indexOf(a) - ISSUER_ORDER.indexOf(b))
    .map(([issuer, grades]) => ({
      issuer,
      grades: [...grades.values()].sort((a, b) => b.gradeTenths - a.gradeTenths),
    }));
}

/** Kortets förvalda betyg: högsta med ett aktuellt begärt pris, annars högsta alls. */
export function defaultGrade(card: GradedIssuerCard): number {
  return (card.grades.find((g) => g.ask) ?? card.grades[0]).gradeTenths;
}
