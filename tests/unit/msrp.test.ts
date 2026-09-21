import { describe, it, expect } from "vitest";
import { msrpDelta, resolveMsrpOre, MSRP_DEFAULT_ORE } from "@/lib/msrp";

describe("msrpDelta", () => {
  it("under rek. pris = good, med negativ diff och procent", () => {
    expect(msrpDelta(54900, 59900)).toEqual({ msrpOre: 59900, diffOre: -5000, percent: expect.closeTo(-8.35, 1), verdict: "good" });
  });
  it("över rek. pris = bad", () => {
    expect(msrpDelta(74900, 59900)?.verdict).toBe("bad");
    expect(msrpDelta(74900, 59900)?.diffOre).toBe(15000);
  });
  it("exakt rek. pris = good, 0 %", () => {
    expect(msrpDelta(59900, 59900)).toMatchObject({ diffOre: 0, percent: 0, verdict: "good" });
  });
  it("⛔ 0 kr är inget pris — och ingen nolla i nämnaren", () => {
    expect(msrpDelta(0, 59900)).toBeNull();
    expect(msrpDelta(59900, 0)).toBeNull();
    expect(msrpDelta(null, 59900)).toBeNull();
    expect(msrpDelta(59900, undefined)).toBeNull();
  });
});

describe("resolveMsrpOre", () => {
  it("egen kolumn vinner över kategoridefault", () => {
    expect(resolveMsrpOre({ msrpOre: 64900, category: "ETB", language: "EN" })).toBe(64900);
  });
  it("utan kolumn och utan default: null — aldrig en gissning", () => {
    expect(resolveMsrpOre({ msrpOre: null, category: "OTHER", language: "EN" })).toBeNull();
  });
  it("kategoridefault per språk när ägaren fyllt tabellen", () => {
    const saved = MSRP_DEFAULT_ORE.EN;
    MSRP_DEFAULT_ORE.EN = { ETB: 59900 };
    try {
      expect(resolveMsrpOre({ msrpOre: null, category: "ETB", language: "EN" })).toBe(59900);
      expect(resolveMsrpOre({ msrpOre: null, category: "ETB", language: "JP" })).toBeNull();
      expect(resolveMsrpOre({ msrpOre: null, category: "ETB", language: null })).toBe(59900);
    } finally {
      MSRP_DEFAULT_ORE.EN = saved;
    }
  });
});
