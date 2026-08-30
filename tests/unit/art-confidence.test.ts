/**
 * TRUST-DOMEN (artConfidentFrom): basregeln (poäng + marginal) och den
 * samstämmighets-utvidgade varianten (alla rutors topp-1 = bästa rutans topp-1
 * → marginalkravet sänks 0,10 → 0,05). Trösklarna är mätta — se
 * ART_AGREE_MARGIN i src/services/scanner/index.ts.
 */
import { describe, expect, it } from "vitest";
import {
  ART_AGREE_MARGIN,
  ART_TRUST_MARGIN,
  ART_TRUST_SCORE,
  artConfidentFrom,
} from "@/services/scanner/index";

const m = (cardId: string, score: number) => ({ cardId, score });

describe("artConfidentFrom — språktvillingar (2026-08-31)", () => {
  // Fältfall: Vileplume 151 EN 0,80 och Vileplume 151 (JP) 0,79 — samma konst,
  // marginal 0,01. Utan predikatet: osäker ⇒ Gemini. Med: rivalen är nästa
  // ANDRA kort (0,60), marginal 0,20 ⇒ bilden avgör, gratis.
  const twin = (id: string) => id === "vileplume-jp";
  it("mäter marginalen mot första rivalen som INTE är en tvilling", () => {
    const best = [m("vileplume-en", 0.8), m("vileplume-jp", 0.79), m("oddish", 0.6)];
    expect(artConfidentFrom(best, [])).toBeNull();
    expect(artConfidentFrom(best, [], twin)).toBe("vileplume-en");
  });
  it("enbart tvillingar i listan = entydigt kort", () => {
    expect(artConfidentFrom([m("vileplume-en", 0.8), m("vileplume-jp", 0.79)], [], twin)).toBe("vileplume-en");
  });
  it("⛔ en RIKTIG rival nära toppen är fortfarande osäker", () => {
    const best = [m("vileplume-en", 0.8), m("vileplume-jp", 0.79), m("oddish", 0.75)];
    expect(artConfidentFrom(best, [], twin)).toBeNull();
  });
  it("samstämmighet räknar en tvilling på en rutas topp som samma kort", () => {
    const best = [m("vileplume-en", 0.8), m("vileplume-jp", 0.79), m("oddish", 0.74)];
    const tops = [m("vileplume-en", 0.8), m("vileplume-jp", 0.79)];
    expect(artConfidentFrom(best, tops, twin)).toBe("vileplume-en");
  });
});

describe("artConfidentFrom", () => {
  it("basregeln: poäng ≥ 0,55 och marginal ≥ 0,10 → säker", () => {
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.65)], [])).toBe("a");
  });

  it("under marginal utan samstämmighet → inte säker", () => {
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.74)], [])).toBeNull();
  });

  it("samstämmighet sänker marginalkravet till 0,05", () => {
    const tops = [m("a", 0.8), m("a", 0.78), m("a", 0.81)];
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.74)], tops)).toBe("a");
  });

  it("samstämmighet räcker ALDRIG under 0,05 (syskonfallen: 0,005–0,018)", () => {
    const tops = [m("a", 0.8), m("a", 0.78), m("a", 0.81)];
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.782)], tops)).toBeNull();
  });

  it("en avvikande ruta bryter samstämmigheten", () => {
    const tops = [m("a", 0.8), m("x", 0.7), m("a", 0.81)];
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.74)], tops)).toBeNull();
  });

  it("rutorna måste vara ense om BÄSTA rutans kort, inte något annat", () => {
    const tops = [m("x", 0.9), m("x", 0.88)];
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.74)], tops)).toBeNull();
  });

  it("en ensam ruta ger ingen samstämmighet (basregeln gäller)", () => {
    expect(artConfidentFrom([m("a", 0.8), m("b", 0.74)], [m("a", 0.8)])).toBeNull();
  });

  it("låg poäng är aldrig säker, oavsett marginal och samstämmighet", () => {
    const tops = [m("a", 0.5), m("a", 0.5)];
    expect(artConfidentFrom([m("a", 0.5), m("b", 0.2)], tops)).toBeNull();
  });

  it("konstanterna står där mätningen satte dem", () => {
    expect(ART_TRUST_SCORE).toBe(0.55);
    expect(ART_TRUST_MARGIN).toBe(0.1);
    expect(ART_AGREE_MARGIN).toBe(0.05);
  });
});
