import { describe, it, expect } from "vitest";
import { fromElseTrend, TREND_LOW_MULT, TREND_HIGH_MULT } from "@/jobs/cardmarket-refresh";

describe("fromElseTrend (ägarens From → trend → 30d)", () => {
  it("använder From när den är rimlig mot trenden", () => {
    expect(fromElseTrend(8, 8.45, 6.2)).toBe(8); // From ≈ trend
    expect(fromElseTrend(8.45 * TREND_LOW_MULT, 8.45, 6.2)).toBe(8.45 * TREND_LOW_MULT); // exakt på golvet
    expect(fromElseTrend(8.45 * TREND_HIGH_MULT, 8.45, 6.2)).toBe(8.45 * TREND_HIGH_MULT); // exakt på taket
  });

  it("hoppar en From som ligger LÅNGT UNDER trenden → trend (Aggron-fallet)", () => {
    // From 3,5€ mot trend 8,45€ (0,41x < 0,5x) → använd trenden
    expect(fromElseTrend(3.5, 8.45, 6.2)).toBe(8.45);
  });

  it("hoppar en From som ligger LÅNGT ÖVER trenden → trend (skräplistning)", () => {
    expect(fromElseTrend(2000, 780, 524)).toBe(780);
  });

  it("litar på From när ingen trend finns att döma mot", () => {
    expect(fromElseTrend(3.5, null, 6.2)).toBe(3.5);
    expect(fromElseTrend(3.5, 0, 6.2)).toBe(3.5);
  });

  it("faller vidare till 30d när From saknas OCH trend saknas", () => {
    expect(fromElseTrend(null, null, 6.2)).toBe(6.2);
    expect(fromElseTrend(undefined, undefined, 6.2)).toBe(6.2);
  });

  it("använder trend när From saknas men trend finns", () => {
    expect(fromElseTrend(null, 8.45, 6.2)).toBe(8.45);
  });

  it("returnerar null när inget är användbart", () => {
    expect(fromElseTrend(null, null, null)).toBeNull();
    expect(fromElseTrend(0, 0, 0)).toBeNull();
  });
});
