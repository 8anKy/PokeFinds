import { describe, it, expect } from "vitest";
import { SPIN_DURATION_SEC, SPIN_HOLD_SEC, faceStrips, spinAngleAt } from "@/lib/slab-spin";

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

/** Skärpan: remsorna får aldrig trycka ihop texturen ojämnt (fältrapport 2026-10-02). */
describe("faceStrips", () => {
  const FOCAL = 3000;
  const base = { cx: 546, halfW: 319.2, texW: 760 };
  const proj = (u: number, w: number, sin: number, cos: number) => {
    const X = u * cos + w * sin;
    const Z = -u * sin + w * cos;
    return base.cx + (X * FOCAL) / (FOCAL + Z);
  };
  const setup = (deg: number, front: boolean) => {
    const th = (deg * Math.PI) / 180;
    const sin = Math.sin(th);
    const cos = Math.cos(th);
    const w = front ? -21.84 : 21.84;
    const uOfT = (t: number) => (front ? -base.halfW + (t / base.texW) * 2 * base.halfW : base.halfW - (t / base.texW) * 2 * base.halfW);
    const xA = proj(uOfT(0), w, sin, cos);
    const xB = proj(uOfT(base.texW), w, sin, cos);
    return { p: { ...base, sin, cos, depthW: w, front, xA, xB }, uOfT, w, sin, cos };
  };

  it("rakt framifrån ritas sidan i ETT drag", () => {
    const { p } = setup(0, true);
    const s = faceStrips(p);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ t0: 0, t1: 760, x0: p.xA, x1: p.xB });
    expect(faceStrips(setup(180, false).p)).toHaveLength(1);
    expect(faceStrips(setup(360, true).p)).toHaveLength(1);
  });

  for (const [deg, front] of [
    [25, true],
    [70, true],
    [130, false],
    [300, true],
  ] as const) {
    it(`vriden ${deg}°: kant mot kant, hela pixlar inuti, och texturen följer perspektivet exakt`, () => {
      const { p, uOfT, w, sin, cos } = setup(deg, front);
      const s = faceStrips(p);
      expect(s.length).toBeGreaterThan(1);
      expect(s.length).toBeLessThanOrEqual(97);
      expect(s[0].x0).toBeCloseTo(Math.min(p.xA, p.xB), 9);
      expect(s[s.length - 1].x1).toBeCloseTo(Math.max(p.xA, p.xB), 9);
      expect(s[0].t0).toBe(0);
      expect(s[s.length - 1].t1).toBe(760);
      for (let i = 0; i < s.length - 1; i++) {
        expect(s[i].x1).toBe(s[i + 1].x0);
        expect(s[i].t1).toBeCloseTo(s[i + 1].t0, 9);
        expect(Number.isInteger(s[i].x1)).toBe(true);
        // Texturkolumnen t1 projiceras tillbaka exakt på skärmkolumnen x1.
        expect(proj(uOfT(s[i].t1), w, sin, cos)).toBeCloseTo(s[i].x1, 6);
      }
    });
  }
});
