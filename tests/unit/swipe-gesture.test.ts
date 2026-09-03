/**
 * Svep-besluten (flikar + bakåt) — rena funktioner, samma trösklar överallt.
 */
import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_PX,
  lockAxis,
  resolveBackSwipe,
  resolveTabSwipe,
  rubberBand,
} from "@/lib/swipe-gesture";

const W = 400;
const slow = (dx: number) => ({ dx, width: W, velocityPxPerMs: dx / 1000 });
const flick = (dx: number) => ({ dx, width: W, velocityPxPerMs: dx / 40 });

describe("lockAxis", () => {
  it("låser inte förrän fingret rört sig AXIS_LOCK_PX", () => {
    expect(lockAxis(AXIS_LOCK_PX - 1, AXIS_LOCK_PX - 1)).toBeNull();
    expect(lockAxis(0, 0)).toBeNull();
  });
  it("vågrätt när |dx| > |dy|, annars lodrätt (= native scroll)", () => {
    expect(lockAxis(20, 5)).toBe("x");
    expect(lockAxis(-20, 5)).toBe("x");
    expect(lockAxis(5, 20)).toBe("y");
    expect(lockAxis(10, 10)).toBe("y");
  });
});

describe("resolveTabSwipe", () => {
  const mid = { canPrev: true, canNext: true };

  it("långsamt drag förbi en fjärdedel av bredden byter flik", () => {
    expect(resolveTabSwipe({ ...slow(-(W / 4 + 1)), ...mid })).toBe(1);
    expect(resolveTabSwipe({ ...slow(W / 4 + 1), ...mid })).toBe(-1);
  });
  it("långsamt kort drag stannar", () => {
    expect(resolveTabSwipe({ ...slow(-(W / 4 - 1)), ...mid })).toBe(0);
    expect(resolveTabSwipe({ ...slow(60), ...mid })).toBe(0);
  });
  it("ett snärt räcker även om draget är kort — men inte ett mikroskopiskt", () => {
    expect(resolveTabSwipe({ ...flick(-60), ...mid })).toBe(1);
    expect(resolveTabSwipe({ ...flick(60), ...mid })).toBe(-1);
    expect(resolveTabSwipe({ ...flick(-20), ...mid })).toBe(0);
  });
  it("vid en kant stannar vi oavsett hur långt draget var", () => {
    expect(resolveTabSwipe({ ...slow(-W), canPrev: true, canNext: false })).toBe(0);
    expect(resolveTabSwipe({ ...slow(W), canPrev: false, canNext: true })).toBe(0);
  });
  it("motståndet vid kanten är en tredjedel av fingrets rörelse", () => {
    expect(rubberBand(90)).toBe(30);
    expect(rubberBand(-90)).toBe(-30);
  });
});

describe("resolveBackSwipe", () => {
  it("bara åt höger, förbi en fjärdedel eller som snärt", () => {
    expect(resolveBackSwipe(slow(W / 4 + 1))).toBe(true);
    expect(resolveBackSwipe(flick(60))).toBe(true);
    expect(resolveBackSwipe(slow(W / 4 - 1))).toBe(false);
    expect(resolveBackSwipe(slow(-W))).toBe(false);
    expect(resolveBackSwipe(flick(-60))).toBe(false);
  });
});
