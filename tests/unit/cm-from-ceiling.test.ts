import { describe, it, expect } from "vitest";
import {
  fromExceedsCardmarket,
  cmGuideIsRich,
  cmGuideMedianEur,
  singlesHeadlineEur,
  FROM_CEILING_MULT,
} from "../../src/jobs/cardmarket-refresh";

// GRUNDFALLET (2026-07-27, ägarens skärmdump av Cardmarkets egen produktsida):
// Ponyta (BS 60), filter NM + engelska → From 4,29 € (105 annonser, billigaste NM/EN
// 4,29 och 4,93 €). Price Trend 3,41 €, 30-dagarssnitt 8,01 € — identiskt med guide-raden
// för den idProduct vi länkar, så identiteten är bevisad. Vi publicerade 25,66 €.
const PONYTA_GUIDE = { low: 1.25, trend: 3.41, avg: 7.64, avg1: 2.45, avg7: 6.38, avg30: 8.01 };
const PONYTA_TRUE_FROM = 4.29;

describe("fromExceedsCardmarket", () => {
  it("fångar 25,66 € mot en marknad CM själv toppar på 8,01 €", () => {
    expect(fromExceedsCardmarket(25.66, PONYTA_GUIDE)).toBe(true);
  });

  it("släpper igenom det SANNA From-priset", () => {
    expect(fromExceedsCardmarket(PONYTA_TRUE_FROM, PONYTA_GUIDE)).toBe(false);
    // Ett From får ligga över snittet — billiga annonser säljs ut. Taket sitter på ×2,5.
    expect(fromExceedsCardmarket(8.01 * (FROM_CEILING_MULT - 0.1), PONYTA_GUIDE)).toBe(false);
  });

  it("kräver en RIK guide-rad — tunn eller degenererad rad får inte döma", () => {
    // trend=0,02 förekommer i CM:s guide på kort som handlas för 20 €.
    expect(fromExceedsCardmarket(20, { trend: 0.02 })).toBe(false);
    expect(fromExceedsCardmarket(20, { trend: 0.02, low: 0.02 })).toBe(false);
    // Professor Sycamore · Steam Siege 114/114: fyra fält, ALLA 0,05 € = CM:s
    // platshållare. Utan degenerationskravet skrev vakten 5 öre på ett 10 €-kort.
    expect(fromExceedsCardmarket(10, { trend: 0.05, avg30: 0.05, avg1: 0.05, avg7: 0.05 })).toBe(false);
  });

  it("ingen guide-rad = ingen dom", () => {
    expect(fromExceedsCardmarket(25.66, null)).toBe(false);
    expect(fromExceedsCardmarket(25.66, undefined)).toBe(false);
  });

  it("saknat From dömer inte", () => {
    expect(fromExceedsCardmarket(null, PONYTA_GUIDE)).toBe(false);
    expect(fromExceedsCardmarket(0, PONYTA_GUIDE)).toBe(false);
  });
});

describe("cmGuideIsRich", () => {
  it("Ponytas rad duger: sex fält, sex olika värden, spridning 6,4x", () => {
    expect(cmGuideIsRich(PONYTA_GUIDE)).toBe(true);
  });

  it("för få fält duger inte", () => {
    expect(cmGuideIsRich({ trend: 3, avg30: 5, low: 1 })).toBe(false);
  });

  it("fyra fält men samma värde = platshållare, inte marknad", () => {
    expect(cmGuideIsRich({ trend: 0.05, avg30: 0.05, avg1: 0.05, avg7: 0.05 })).toBe(false);
    // Två distinkta räcker inte heller — en riktig marknad spretar mer än så.
    expect(cmGuideIsRich({ trend: 0.05, avg30: 0.05, avg1: 0.1, avg7: 0.1 })).toBe(false);
  });

  it("extrem spridning = motsägelsefull rad, ingen dom", () => {
    expect(cmGuideIsRich({ low: 0.02, trend: 3, avg: 5, avg30: 900 })).toBe(false);
  });
});

describe("cmGuideMedianEur", () => {
  it("landar nära Ponytas sanna From (enda kortet med känt facit)", () => {
    const mid = cmGuideMedianEur(PONYTA_GUIDE)!;
    expect(mid).toBeCloseTo(4.895, 3);
    expect(Math.abs(mid / PONYTA_TRUE_FROM - 1)).toBeLessThan(0.2); // inom 20 %
  });

  it("hanterar hål i guide-raden", () => {
    expect(cmGuideMedianEur({ trend: 4, avg30: 6 })).toBe(5);
    expect(cmGuideMedianEur({ trend: 4 })).toBe(4);
    expect(cmGuideMedianEur({})).toBeNull();
    expect(cmGuideMedianEur({ trend: 0, low: null })).toBeNull();
  });
});

describe("singlesHeadlineEur — taket", () => {
  it("Ponyta: 25,66 € ersätts av CM:s egen mittpunkt, inte av feedvärdet", () => {
    const r = singlesHeadlineEur({ from: 25.66, avg30: 8.01 }, PONYTA_GUIDE)!;
    expect(r.via).toBe("cmMedian");
    expect(r.eur).toBeCloseTo(4.895, 3);
    // Lagerstatus ska förbli IN_STOCK: CM HAR annonser, det är siffran som var fel.
    expect(r.from).toBe(true);
  });

  it("ett rimligt From publiceras rakt av — golvet-rakt-av gäller fortfarande", () => {
    const r = singlesHeadlineEur({ from: PONYTA_TRUE_FROM, avg30: 8.01 }, PONYTA_GUIDE)!;
    expect(r).toEqual({ eur: 4.29, from: true, via: "from" });
  });

  it("för LÅGT From publicerar CM:s low precis som förut (07-25-fixen intakt)", () => {
    const r = singlesHeadlineEur({ from: 0.02, avg30: 3.2 }, { low: 1.25, trend: 1.4, avg: 1.5, avg30: 1.45 })!;
    expect(r).toEqual({ eur: 1.25, from: true, via: "cmLow" });
  });

  it("From saknas → uppskattning märkt OUT_OF_STOCK, oförändrat", () => {
    const r = singlesHeadlineEur({ from: null, avg30: 3.04 }, { trend: 2.3, avg: 2.31, avg30: 3.04 })!;
    expect(r.from).toBe(false);
    expect(r.via).toBe("estimate");
  });

  it("inget att gå på → null (inget skrivs)", () => {
    expect(singlesHeadlineEur({ from: null, avg30: null }, null)).toBeNull();
  });

  it("utan guide-rad står feedens From kvar (ingen dom utan facit)", () => {
    const r = singlesHeadlineEur({ from: 25.66, avg30: null }, null)!;
    expect(r).toEqual({ eur: 25.66, from: true, via: "from" });
  });
});
