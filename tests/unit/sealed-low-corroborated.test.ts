/**
 * ETT GOLV UNDER SNITTEN SOM ANDRA SPRÅK BEKRÄFTAR (2026-11-23).
 * Mega Evolution Fun Pack stod som "uppskattat" 784 kr: en affär à 1 100 € hade förgiftat
 * trend/30d, och den engelska From 1,36 € föll på 20 %-golvet fast 407 annonser låg där.
 */
import { describe, expect, it } from "vitest";
import { lowIsCredible, sealedLowCorroboratedOnLiquid } from "@/jobs/cardmarket-refresh";

describe("sealedLowCorroboratedOnLiquid", () => {
  it("fun packs: snitten fäller golvet, de andra språken och likviditeten räddar det", () => {
    // Mega Evolution Fun Pack: EN 1,36 · DE 3,00 FR 1,00 ES 2,99 IT 5,00 · 30d 11,08 · trend 30,42 · 407 annonser
    expect(lowIsCredible(1.36, 11.08, 30.42)).toBe(false);
    expect(sealedLowCorroboratedOnLiquid(1.36, [3.0, 1.0, 2.99, 5.0], 407)).toBe(true);
    // Lost Origin Fun Pack: EN 1,75 · trend 376,57
    expect(sealedLowCorroboratedOnLiquid(1.75, [8.49, 1.7, 2.3], 788)).toBe(true);
  });

  it("en tunn marknad kan inte bekräfta sig själv (tom vintagebox på två språk)", () => {
    expect(sealedLowCorroboratedOnLiquid(100, [120], 4)).toBe(false);
    expect(sealedLowCorroboratedOnLiquid(100, [120], 99)).toBe(false);
  });

  it("utan ett annat språk på samma nivå ingen bekräftelse", () => {
    expect(sealedLowCorroboratedOnLiquid(153.61, [], 716)).toBe(false); // 30th PC ETB: bara engelska
    expect(sealedLowCorroboratedOnLiquid(1.0, [2.0, 20.0, 2.4], 115)).toBe(false); // närmaste 2,00 > 1,5x
    expect(sealedLowCorroboratedOnLiquid(null, [1, 2], 500)).toBe(false);
  });
});
