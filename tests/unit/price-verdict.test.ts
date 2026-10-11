/**
 * KANTFÄRGEN I DISCORD — grön/orange/röd (ägarbeslut 2026-10-11), src/lib/market-compare.ts.
 * Orange = över Cardmarket men på/under Tradera-medianen; reservband 10 % utan Tradera.
 */
import { describe, expect, it } from "vitest";
import { FAIR_FALLBACK_PERCENT, PRICE_VERDICT_COLOR, priceEdgeColor, priceVerdict } from "@/lib/market-compare";

const BRAND = 0x2dd4bf;

describe("priceVerdict", () => {
  it("på/under marknadsvärdet = good, oavsett Tradera", () => {
    expect(priceVerdict(64900, 67958, 92700, 112)).toBe("good");
    expect(priceVerdict(67958, 67958, null, null)).toBe("good");
  });

  it("mellan marknadsvärdet och Tradera-medianen = fair (orange)", () => {
    expect(priceVerdict(80000, 67958, 92700, 112)).toBe("fair");
    expect(priceVerdict(92700, 67958, 92700, 112)).toBe("fair");
  });

  it("över Tradera-medianen = bad", () => {
    expect(priceVerdict(99900, 67958, 92700, 112)).toBe("bad");
  });

  it("⛔ Tradera UNDER marknadsvärdet ⇒ inget mellanband: över marknaden = bad", () => {
    expect(priceVerdict(60000, 55000, 50000, 10)).toBe("bad");
    expect(priceVerdict(50000, 55000, 50000, 10)).toBe("good");
  });

  it("bara Tradera: på/under medianen good, över bad (Mini Tin 219 mot 350)", () => {
    expect(priceVerdict(21900, null, 35000, 18)).toBe("good");
    expect(priceVerdict(39900, null, 35000, 18)).toBe("bad");
  });

  it("bara marknadsvärde: reservband ≤ 10 % över = fair, mer = bad", () => {
    expect(FAIR_FALLBACK_PERCENT).toBe(10);
    expect(priceVerdict(54000, 50000, null, null)).toBe("fair");
    expect(priceVerdict(55000, 50000, null, null)).toBe("fair");
    expect(priceVerdict(55100, 50000, null, null)).toBe("bad");
  });

  it("⛔ Tradera under tre affärer räknas inte (samma grind som raden)", () => {
    expect(priceVerdict(80000, 67958, 92700, 2)).toBe("bad");
    expect(priceVerdict(21900, null, 35000, 2)).toBeNull();
  });

  it("⛔ inget riktigt pris eller ingen jämförelse ⇒ null", () => {
    expect(priceVerdict(null, 50000, 60000, 5)).toBeNull();
    expect(priceVerdict(0, 50000, 60000, 5)).toBeNull();
    expect(priceVerdict(50000, null, null, null)).toBeNull();
    expect(priceVerdict(50000, 0, 0, 5)).toBeNull();
  });
});

describe("priceEdgeColor", () => {
  it("grön/orange/röd, annars varumärket", () => {
    expect(priceEdgeColor(BRAND, 64900, 67958)).toBe(PRICE_VERDICT_COLOR.good);
    expect(priceEdgeColor(BRAND, 80000, 67958, 92700, 112)).toBe(0xf97316);
    expect(priceEdgeColor(BRAND, 99900, 67958, 92700, 112)).toBe(PRICE_VERDICT_COLOR.bad);
    expect(priceEdgeColor(BRAND, 50000, null)).toBe(BRAND);
  });
});
