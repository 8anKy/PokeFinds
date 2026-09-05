/**
 * /marknad:s "största rörelser". Första-mot-sista gjorde listan till en
 * glitchdetektor (+9 032 % på en POP-promo, en Wooper på 99 911 kr). Testet
 * vaktar att en ensam dag inte kan avgöra en rörelse och att orimliga hopp
 * hålls borta från listan — utan att riktiga rörelser försvinner.
 */
import { describe, expect, it } from "vitest";
import {
  MOVER_MAX_RATIO,
  MOVER_MIN_POINTS,
  MOVER_MIN_PRICE_ORE,
  median,
  summarizeMove,
} from "@/lib/market-movers";

describe("median", () => {
  it("udda och jämnt antal", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(3); // (2+3)/2 avrundat
    expect(median([5])).toBe(5);
  });
});

describe("summarizeMove", () => {
  it("en riktig, jämn rörelse räknas", () => {
    const m = summarizeMove([10000, 10200, 10500, 11000, 11500, 12000, 12500]);
    expect(m).not.toBeNull();
    expect(m!.firstPrice).toBe(10350); // medianen av de fyra första (10200+10500)/2
    expect(m!.lastPrice).toBe(11750); // medianen av de fyra sista
    expect(m!.changePercent).toBeCloseTo(13.53, 1);
  });

  it("⛔ en ensam glitchdag i slutet avgör inte längre rörelsen (Gallade-fallet)", () => {
    // 60 kr hela veckan, sista dagen 5 550 kr ⇒ förut +9 032 %.
    const m = summarizeMove([6077, 6077, 6077, 6077, 6077, 6077, 555000]);
    // Medianen av sista halvan är fortfarande 60,77 ⇒ ingen rörelse alls.
    expect(m!.changePercent).toBe(0);
  });

  it("⛔ en ensam glitchdag i början gör inte ett ras (Undaunted-fallet)", () => {
    const m = summarizeMove([49635000, 6105000, 6105000, 6105000, 6105000]);
    expect(m!.changePercent).toBe(0);
  });

  it("orimliga veckohopp visas inte som rörelser", () => {
    // Hela andra halvan ×10 — det är en datahändelse, inte en trend.
    expect(summarizeMove([10000, 10000, 10000, 100000, 100000, 100000])).toBeNull();
    expect(summarizeMove([100000, 100000, 100000, 10000, 10000, 10000])).toBeNull();
    // Precis under taket räknas.
    const ok = summarizeMove([10000, 10000, 10000, 39000, 39000, 39000]);
    expect(ok).not.toBeNull();
    expect(MOVER_MAX_RATIO).toBe(4);
  });

  it("golv och minsta antal punkter", () => {
    expect(summarizeMove([500, 600, 900])).toBeNull(); // under 10 kr
    expect(summarizeMove([10000, 20000])).toBeNull(); // för få punkter
    expect(MOVER_MIN_PRICE_ORE).toBe(1000);
    expect(MOVER_MIN_POINTS).toBe(3);
  });

  it("tre punkter: mitten delas av båda halvorna", () => {
    const m = summarizeMove([10000, 12000, 14000]);
    expect(m!.firstPrice).toBe(11000);
    expect(m!.lastPrice).toBe(13000);
  });
});
