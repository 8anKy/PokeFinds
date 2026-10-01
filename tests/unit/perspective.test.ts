import { describe, expect, it } from "vitest";
import { applyH, convexHull, homography, projectBox, straightLayout, warpPerspective, CARD_ASPECT, type Pt } from "@/lib/perspective";

describe("perspektiv", () => {
  it("homografin avbildar de fyra hörnen exakt", () => {
    const src: Pt[] = [{ x: 12, y: 30 }, { x: 410, y: 18 }, { x: 430, y: 600 }, { x: 5, y: 590 }];
    const dst: Pt[] = [{ x: 0, y: 0 }, { x: 630, y: 0 }, { x: 630, y: 880 }, { x: 0, y: 880 }];
    const h = homography(src, dst)!;
    for (let i = 0; i < 4; i++) {
      const p = applyH(h, src[i]);
      expect(p.x).toBeCloseTo(dst[i].x, 6);
      expect(p.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("vägrar ett degenererat fyrhörn", () => {
    const line: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(homography(line, line)).toBeNull();
  });

  it("varpningen räta upp ett snett kort: en svart ram blir rak", () => {
    // Källa 40×40: vitt, med en svart pixelrad på y=10.
    const w = 40;
    const src = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let x = 0; x < w; x++) { const o = (10 * w + x) * 4; src[o] = src[o + 1] = src[o + 2] = 0; }
    // Identitet: utbilden ska ha samma rad.
    const id = homography(
      [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
      [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]
    )!;
    const out = warpPerspective({ data: src, width: w, height: w }, id, w, w);
    expect(out[(10 * w + 20) * 4]).toBe(0);
    expect(out[(20 * w + 20) * 4]).toBe(255);
    expect(out[(20 * w + 20) * 4 + 3]).toBe(255);
  });

  it("utanför källan blir genomskinligt", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const grow = homography(
      [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }],
      [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }]
    )!;
    const out = warpPerspective({ data: src, width: 4, height: 4 }, grow, 8, 8);
    expect(out[(7 * 8 + 7) * 4 + 3]).toBe(0);
  });

  it("den raka layouten har kortets proportioner och en marginal", () => {
    const l = straightLayout(900);
    expect(l.rect.w / l.rect.h).toBeCloseTo(CARD_ASPECT, 2);
    expect(l.rect.x).toBeGreaterThan(0);
    expect(l.width).toBe(l.rect.w + 2 * l.rect.x);
  });

  it("3D-lådan: högerkanten blir kortare när den vrids bort", () => {
    const { front } = projectBox(700, 1000, 50, 0, 15, 2400, { x: 0, y: 0 });
    const left = front[3].y - front[0].y;
    const right = front[2].y - front[1].y;
    expect(right).toBeLessThan(left);
    expect(convexHull([...front]).length).toBe(4);
  });
});
