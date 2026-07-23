import { describe, it, expect } from "vitest";
import {
  singlesHeadlineEur,
  feedMoveShares,
  DAY_MOVE_MAX,
  FEED_BREAKER_MULT,
} from "@/jobs/cardmarket-refresh";

// Ägarbeslut 2026-07-24: GOLVET RAKT AV. Rayquaza ★ Deoxys — CM:s From var 37 000 €
// (PSA 7-ask) men vi visade trenden 6 271 € som "Lägsta pris". Golvet ska visas
// ofiltrerat; trend/30d är BARA fallback när From saknas, och då en uppskattning.
describe("singlesHeadlineEur (golvet rakt av)", () => {
  it("From publiceras exakt som CM listar den, hur långt från trenden den än ligger", () => {
    expect(singlesHeadlineEur(37000, 6271.49, 4093.09)).toEqual({ eur: 37000, from: true });
    // Skräp-låg From accepteras också — det är CM:s golv, inte vårt påhitt.
    expect(singlesHeadlineEur(3.5, 8.45, 6.2)).toEqual({ eur: 3.5, from: true });
  });

  it("From saknas → trend som uppskattning (from=false)", () => {
    expect(singlesHeadlineEur(null, 6271.49, 4093.09)).toEqual({ eur: 6271.49, from: false });
  });

  it("From och trend saknas → 30d-snittet som uppskattning", () => {
    expect(singlesHeadlineEur(null, null, 4093.09)).toEqual({ eur: 4093.09, from: false });
  });

  it("ingen data alls (eller bara nollor) → null", () => {
    expect(singlesHeadlineEur(null, null, null)).toBeNull();
    expect(singlesHeadlineEur(0, 0, 0)).toBeNull();
  });
});

// Haveribrytaren skyddar mot 2026-07-05-klassen: RapidAPI korrumperar en stor ANDEL
// av feeden samtidigt. Enstaka vilda hopp är asks-marknad och räknas bara som stora.
describe("feedMoveShares", () => {
  it("räknar stora (≥3x) och extrema (≥10x) dagsrörelser åt båda hållen", () => {
    const shares = feedMoveShares([
      { newOre: 100, priorOre: 100 },   // stilla
      { newOre: 350, priorOre: 100 },   // 3.5x upp = stor
      { newOre: 100, priorOre: 350 },   // 3.5x ner = stor
      { newOre: 1500, priorOre: 100 },  // 15x = extrem (och stor)
      { newOre: 100, priorOre: null },  // nytt kort utan gårdagsvärde — utanför nämnaren
    ]);
    expect(shares.n).toBe(4);
    expect(shares.big).toBe(3);
    expect(shares.extreme).toBe(1);
    expect(shares.extremeShare).toBeCloseTo(0.25);
  });

  it("tom eller gårdagslös feed ger 0-andelar (ingen division med noll)", () => {
    expect(feedMoveShares([]).extremeShare).toBe(0);
    expect(feedMoveShares([{ newOre: 100, priorOre: null }]).n).toBe(0);
  });

  it("trösklarna är de förväntade defaultvärdena", () => {
    expect(DAY_MOVE_MAX).toBe(3);
    expect(FEED_BREAKER_MULT).toBe(10);
  });
});
