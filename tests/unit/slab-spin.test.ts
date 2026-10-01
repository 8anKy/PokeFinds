import { describe, it, expect } from "vitest";
import { SPIN_DURATION_SEC, SPIN_HOLD_SEC, spinAngleAt } from "@/lib/slab-spin";

/** Videon loopar: slutet måste vara exakt början, och framsidan står still först. */
describe("spinAngleAt", () => {
  it("står still med framsidan mot betraktaren under pausen", () => {
    expect(spinAngleAt(0)).toBe(0);
    expect(spinAngleAt(SPIN_HOLD_SEC)).toBe(0);
  });
  it("vänder baksidan till mitt i varvet och når ett helt varv i slutet", () => {
    const mid = SPIN_HOLD_SEC + (SPIN_DURATION_SEC - SPIN_HOLD_SEC) / 2;
    expect(spinAngleAt(mid)).toBeCloseTo(180, 5);
    expect(spinAngleAt(SPIN_DURATION_SEC - 1e-9)).toBeCloseTo(360, 3);
  });
  it("loopar sömlöst", () => {
    expect(spinAngleAt(SPIN_DURATION_SEC)).toBe(0);
    expect(spinAngleAt(SPIN_DURATION_SEC + 1)).toBeCloseTo(spinAngleAt(1), 9);
  });
  it("rör sig bara framåt", () => {
    let prev = -1;
    for (let t = 0; t < SPIN_DURATION_SEC; t += 0.05) {
      const a = spinAngleAt(t);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});
