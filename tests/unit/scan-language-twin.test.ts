import { describe, expect, it } from "vitest";
import { isAmbiguous, isTied, preferTwinLanguage } from "@/services/scanner";
import { LANG_HINT_TTL_MS, parseLangHint } from "@/lib/scan-language-hint";
import { pickAlternatives, pickSameArtRail, type RailLike } from "@/lib/scan-alternatives";
import type { ScanCandidate } from "@/services/scanner/types";

/**
 * SPRÅKTVILLINGEN (2026-09-22): samma kort på EN och JP har samma konst. Fältets
 * största korrigeringshink (~70 av ~220) — tvillingen låg ofta på plats 4+ och
 * EN vann även när användaren skannade en japansk pärm.
 */
describe("preferTwinLanguage", () => {
  it("byter bara när sessionens språk är tvillingens och inte vinnarens", () => {
    expect(preferTwinLanguage("EN", "JP", "JP")).toBe(true);
    expect(preferTwinLanguage("JP", "EN", "EN")).toBe(true);
    expect(preferTwinLanguage("EN", "JP", "EN")).toBe(false);
    expect(preferTwinLanguage("EN", "JP", undefined)).toBe(false); // ägarregeln: EN utan ledtråd
    expect(preferTwinLanguage("EN", "JP", null)).toBe(false);
  });
});

describe("parseLangHint", () => {
  const now = 1_800_000_000_000;
  it("läser ett färskt EN/JP-val", () => {
    expect(parseLangHint(JSON.stringify({ lang: "JP", at: now - 60_000 }), now)).toBe("JP");
  });
  it("glömmer efter 30 min och tål skräp", () => {
    expect(parseLangHint(JSON.stringify({ lang: "JP", at: now - LANG_HINT_TTL_MS - 1 }), now)).toBeUndefined();
    expect(parseLangHint(JSON.stringify({ lang: "DE", at: now }), now)).toBeUndefined();
    expect(parseLangHint("{inte json", now)).toBeUndefined();
    expect(parseLangHint(null, now)).toBeUndefined();
  });
});

const cand = (over: Partial<ScanCandidate> & { cardId: string; score: number }): ScanCandidate => ({
  name: "Primarina",
  setName: "Pitch Black",
  number: "88",
  rarity: "Rare",
  language: "EN",
  imageUrl: null,
  slug: null,
  productId: null,
  variantLabel: null,
  estimatedValue: null,
  ...over,
});

describe("tvillingen är ingen rival", () => {
  it("en tvilling på samma poäng fäller varken '?' eller valsteget", () => {
    const list = [
      cand({ cardId: "en", score: 1.2 }),
      cand({ cardId: "jp", score: 1.2, language: "JP", name: "Primarina (JP)", languageTwin: true }),
      cand({ cardId: "other", score: 0.5, name: "Brionne" }),
    ];
    expect(isTied(list)).toBe(false);
    expect(isAmbiguous(list)).toBe(false);
  });
  it("men ett annat kort på samma poäng gör det fortfarande", () => {
    const list = [cand({ cardId: "en", score: 1.2 }), cand({ cardId: "x", score: 1.2, name: "Brionne" })];
    expect(isTied(list)).toBe(true);
  });
});

describe("tvillingen först i raderna", () => {
  const rows: RailLike[] = [
    { cardId: "match", productId: "p1", name: "Primarina", score: 1.2, sameArt: true },
    { cardId: "reprint", productId: "p2", name: "Primarina", score: 0.9, sameArt: true },
    { cardId: "jp", productId: "p3", name: "Primarina (JP)", score: 0.4, sameArt: true, languageTwin: true },
  ];
  it("konstraden: träffen, sedan tvillingen, sedan omtrycken", () => {
    expect(pickSameArtRail(rows, { cardId: "match", productId: "p1" }).map((c) => c.cardId)).toEqual([
      "match",
      "jp",
      "reprint",
    ]);
  });
  it("alternativlistan: tvillingen först", () => {
    const alts = pickAlternatives(rows, { cardId: "match", productId: "p1" });
    expect(alts[0].cardId).toBe("jp");
  });
});
