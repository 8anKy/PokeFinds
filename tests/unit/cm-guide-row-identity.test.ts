import { describe, it, expect } from "vitest";
import { guideRowIsSingle, singlesHeadlineEur } from "../../src/jobs/cardmarket-refresh";

// Regression 2026-07-26: RapidAPI gav Pidgey · Flashfire 75/106 cardmarket_id 271938,
// som enligt CM:s egna kataloger är en SEALED-produkt. Namnvakten (guideNameMatches)
// släppte igenom den — dess "saknas katalognamn → betrodd" är sant PRECIS när
// idProduct inte finns bland singlarna. Guide-radens `low` (295 €) publicerades då som
// kortets pris: 3 262,70 kr för en common.
//
// Sedan 2026-07-27 får guiden aldrig överpröva feedens From, så just den vägen är
// stängd. Vakten behövs ändå: raden är fortfarande enda källan när `lowest_near_mint`
// SAKNAS, och en sealed-rad skulle då uppskatta en common till en boosterlådas pris.

const CATALOG = new Map<number, string>([
  [660180, "Doduo [Fury Attack]"],
  [895901, "Mega Darkrai ex [Dusk Raid | Abyss Eye]"],
]);

describe("guideRowIsSingle", () => {
  it("godkänner idProduct som finns i CM:s singel-katalog", () => {
    expect(guideRowIsSingle(660180, CATALOG)).toBe(true);
    expect(guideRowIsSingle(895901, CATALOG)).toBe(true);
  });

  it("AVVISAR idProduct som inte är en singel (sealed-produkten som satte 3 262 kr)", () => {
    expect(guideRowIsSingle(271938, CATALOG)).toBe(false);
    expect(guideRowIsSingle(690877, CATALOG)).toBe(false);
  });

  it("avvisar saknat idProduct", () => {
    expect(guideRowIsSingle(null, CATALOG)).toBe(false);
    expect(guideRowIsSingle(undefined, CATALOG)).toBe(false);
  });

  it("står över körningen när katalogen inte kunde hämtas (tom map)", () => {
    // Annars hade ett CDN-fel kastat ALLA guide-rader och gjort varje kort utan From
    // prislöst — samma stand-down som fetchCmSingleNames redan har.
    expect(guideRowIsSingle(271938, new Map())).toBe(true);
    expect(guideRowIsSingle(660180, new Map())).toBe(true);
  });
});

describe("Pidgey-fallet end-to-end", () => {
  // CM:s guide-rad för sealed-produkten 271938: low 295 €, trend 24,66 €, avg 32 €.
  const SEALED_ROW = { low: 295, trend: 24.66, avg: 32, avg30: null };
  const PIDGEY = { from: 0.02, avg30: 0.14 }; // RapidAPI, 1 188 annonser

  it("guide-raden kan inte längre överpröva ett From — inte ens en sealed-rad", () => {
    expect(singlesHeadlineEur(PIDGEY, SEALED_ROW)).toEqual({ eur: 0.02, from: true, via: "from" });
  });

  it("utan raden publiceras samma sak", () => {
    expect(singlesHeadlineEur(PIDGEY, undefined)).toEqual({ eur: 0.02, from: true, via: "from" });
  });

  it("men SAKNAS From bestämmer raden allt — därför måste vakten finnas kvar", () => {
    // Med sealed-raden hade en common uppskattats till boosterlådans nivå.
    // median av [trend 24,66 · avg 32 · RapidAPI 30d 0,14] = 24,66 € på en common.
    expect(singlesHeadlineEur({ from: null, avg30: 0.14 }, SEALED_ROW)).toEqual({
      eur: 24.66,
      from: false,
      via: "estimate",
    });
    // Vakten skickar undefined → kortets eget 30d-snitt blir uppskattningen.
    expect(singlesHeadlineEur({ from: null, avg30: 0.14 }, undefined)).toEqual({
      eur: 0.14,
      from: false,
      via: "estimate",
    });
  });
});
