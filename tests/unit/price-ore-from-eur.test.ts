import { describe, it, expect } from "vitest";
import { priceOreFromEur } from "../../src/lib/exchange-rate";

// Regression 2026-08-05: Grovyle · Nintendo Black Star Promos 4/40 stod på 0,00 kr i
// pristabellen och hade 32 grafpunkter på noll. Källan: RapidAPI publicerar
// `"30d_average": 0` för kort utan engelska annonser (mätt på np-4 — `lowest_near_mint`
// null och CM:s guide-rad helt tom), och före median-uppskattningen 2026-07-25 gick den
// nollan rakt igenom `Math.round(eur * eurToOre)`.
//
// "0 kr" är värre än "–": det senare läses som "vi vet inte", det förra som "gratis".

const rates = { eurToOre: 1150 };

describe("priceOreFromEur", () => {
  it("konverterar ett vanligt pris", () => {
    expect(priceOreFromEur(4.29, rates)).toBe(4934);
  });

  it("släpper igenom små men äkta belopp", () => {
    expect(priceOreFromEur(0.02, rates)).toBe(23);
  });

  // Källan säger noll — den vägen som faktiskt bet oss.
  it("noll är inget pris", () => {
    expect(priceOreFromEur(0, rates)).toBeNull();
  });

  // ⛔ Den andra vägen: ett ÄKTA positivt belopp som avrundas till 0 öre. Ingen
  // pos()-vakt uppströms ser det — där var talet positivt.
  it("ett belopp som avrundas till noll öre är inget pris", () => {
    expect(priceOreFromEur(0.0001, rates)).toBeNull();
    expect(priceOreFromEur(0.0004, rates)).toBeNull(); // 0,46 öre → 0
    expect(priceOreFromEur(0.0005, rates)).toBe(1); // 0,58 öre → 1, fortfarande ett pris
  });

  it("negativt och icke-ändligt är inget pris", () => {
    expect(priceOreFromEur(-5, rates)).toBeNull();
    expect(priceOreFromEur(NaN, rates)).toBeNull();
    expect(priceOreFromEur(Infinity, rates)).toBeNull();
  });

  it("null/undefined passerar oförändrat som 'inget pris'", () => {
    expect(priceOreFromEur(null, rates)).toBeNull();
    expect(priceOreFromEur(undefined, rates)).toBeNull();
  });
});
