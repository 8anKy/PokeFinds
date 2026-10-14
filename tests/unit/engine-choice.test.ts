import { describe, expect, it } from "vitest";
import { ENGINE_NO_CARD_FP_MAX, engineChoiceOrder, engineNoCard } from "@/lib/engine-choice";

describe("motorläget: inget kort i bilden", () => {
  it("noll geometri + svagt avtryck = inget kort (handen)", () => {
    expect(engineNoCard(0, 0.42)).toBe(true);
    expect(engineNoCard(0, null)).toBe(true);
    // ägarens bord 2026-10-14: släpptes igenom av den första tröskeln (0,55)
    expect(engineNoCard(0, 0.569)).toBe(true);
  });
  it("bildvektorn liknar inget kort och geometrin är svag (ägarens datorlåda: 28 inliers, 0,528)", () => {
    expect(engineNoCard(28, 0.543, 0.528)).toBe(true);
    expect(engineNoCard(39, 0.8, 0.5)).toBe(true);
  });
  it("stark geometri eller hög likhet ger en lista; utan bildvektor gäller bara noll-geometri-regeln", () => {
    expect(engineNoCard(40, 0.5, 0.5)).toBe(false);
    expect(engineNoCard(10, 0.5, 0.6)).toBe(false);
    expect(engineNoCard(10, 0.5, null)).toBe(false);
  });
  it("minsta geometri, eller ett avtryck som liknar ett kort, ger fortfarande en lista", () => {
    expect(engineNoCard(1, 0.3)).toBe(false);
    expect(engineNoCard(0, ENGINE_NO_CARD_FP_MAX)).toBe(false);
    expect(engineNoCard(0, 0.7)).toBe(false);
  });
});

describe("motorläget: valstegets ordning", () => {
  it("motorns tre först, sedan avtryckets tills sex, sist resten av motorn", () => {
    expect(engineChoiceOrder(["e1", "e2", "e3", "e4", "e5"], ["a1", "e2", "a2", "a3", "a4"])).toEqual([
      "e1", "e2", "e3", "a1", "a2", "a3", "e4", "e5",
    ]);
  });
  it("inga dubbletter när listorna överlappar, och utan avtryck är det motorns ordning", () => {
    expect(engineChoiceOrder(["e1", "e2"], ["e1", "e2"])).toEqual(["e1", "e2"]);
    expect(engineChoiceOrder(["e1", "e2", "e3", "e4"], [])).toEqual(["e1", "e2", "e3", "e4"]);
  });
});
