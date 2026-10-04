/** Kortets hörn följer med mätningen och sparas — slabbens utsnitt ur ett sparat foto. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/products", () => ({ loadGradedForSlug: vi.fn() }));
vi.mock("@/services/scanner", () => ({ estimateCardValue: vi.fn() }));

import { centeringFromInput, centeringInputSchema } from "@/services/grading/extras";

const quad = [
  { x: 0.1, y: 0.08 },
  { x: 0.88, y: 0.1 },
  { x: 0.86, y: 0.93 },
  { x: 0.12, y: 0.9 },
];

describe("centering cardQuad", () => {
  it("tas emot och sparas på sidan", () => {
    const input = centeringInputSchema.parse({ front: { mode: "standard", leftRight: 53, topBottom: 52, cardQuad: quad } });
    expect(centeringFromInput(input)?.front?.cardQuad).toEqual(quad);
  });
  it("fel antal hörn eller tal långt utanför fotot avvisas", () => {
    expect(() => centeringInputSchema.parse({ front: { mode: "standard", leftRight: 53, cardQuad: quad.slice(0, 3) } })).toThrow();
    expect(() =>
      centeringInputSchema.parse({ front: { mode: "standard", leftRight: 53, cardQuad: [...quad.slice(0, 3), { x: 9, y: 0 }] } })
    ).toThrow();
  });
});

import { cardQuadInPhoto, homography, straightLayout } from "@/lib/perspective";

describe("cardQuadInPhoto", () => {
  it("ytterlinjerna PÅ den räta rektangeln ger tillbaka exakt hörnen användaren lade i fotot", () => {
    const base = { w: 1200, h: 1600 };
    const src = [
      { x: 180, y: 150 },
      { x: 1010, y: 210 },
      { x: 980, y: 1420 },
      { x: 150, y: 1380 },
    ];
    const L = straightLayout(800);
    const { x, y, w, h } = L.rect;
    const H = homography(
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      src
    )!;
    const lines = {
      outerLeft: x / L.width,
      outerRight: (x + w) / L.width,
      outerTop: y / L.height,
      outerBottom: (y + h) / L.height,
    };
    const q = cardQuadInPhoto(lines, { w: L.width, h: L.height }, base, H);
    q.forEach((p, i) => {
      expect(p.x).toBeCloseTo(src[i].x / base.w, 3);
      expect(p.y).toBeCloseTo(src[i].y / base.h, 3);
    });
  });
});
