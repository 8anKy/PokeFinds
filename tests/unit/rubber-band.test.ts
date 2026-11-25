import { describe, expect, it } from "vitest";
import { rubberBand, rubberBandInverse } from "@/components/ui/rubber-band";

describe("rubberBand", () => {
  const dim = 800;

  it("följer fingret först och planar ut — når aldrig skärmhöjden", () => {
    expect(rubberBand(0, dim)).toBe(0);
    expect(rubberBand(10, dim)).toBeGreaterThan(5);
    expect(rubberBand(10, dim)).toBeLessThan(10);
    expect(rubberBand(100_000, dim)).toBeLessThan(dim);
    // Avtagande utväxling: samma steg ger mindre rörelse längre ut.
    expect(rubberBand(200, dim) - rubberBand(100, dim)).toBeLessThan(rubberBand(100, dim));
  });

  it("inversen ger tillbaka dragsträckan", () => {
    for (const d of [5, 60, 240, 700]) {
      expect(rubberBandInverse(rubberBand(d, dim), dim)).toBeCloseTo(d, 6);
    }
  });
});
