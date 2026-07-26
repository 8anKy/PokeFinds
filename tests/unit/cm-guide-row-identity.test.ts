import { describe, it, expect } from "vitest";
import { guideRowIsSingle, singlesHeadlineEur } from "../../src/jobs/cardmarket-refresh";

// Regression 2026-07-26: RapidAPI gav Pidgey · Flashfire 75/106 cardmarket_id 271938,
// som enligt CM:s egna kataloger är en SEALED-produkt. Namnvakten (guideNameMatches)
// släppte igenom den — dess "saknas katalognamn → betrodd" är sant PRECIS när
// idProduct inte finns bland singlarna. Guide-radens `low` (295 €) fick sedan
// fromContradictsCardmarket att förkasta kortets riktiga From (0,02 €) och publicera
// boosterlådans golvpris: 3 262,70 kr för en common. 97 singlar drabbades ≥10x.

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

  it("med sealed-raden publicerades boosterlådans golv", () => {
    const bad = singlesHeadlineEur(PIDGEY, SEALED_ROW);
    expect(bad).toEqual({ eur: 295, from: true }); // ≈3 262 kr — felet
  });

  it("utan raden (vakten slår) publiceras kortets riktiga From", () => {
    const good = singlesHeadlineEur(PIDGEY, undefined);
    expect(good).toEqual({ eur: 0.02, from: true }); // 0,22 kr — det korrekta
  });

  it("en ÄKTA singel-guide-rad får fortfarande döma en orimligt låg From", () => {
    // Vakten får inte avväpna 07-25-fixen: här ÄR raden kortets egen.
    const judged = singlesHeadlineEur({ from: 0.02, avg30: 3.2 }, { low: 1.25, trend: 1.4, avg: 1.5, avg30: 1.45 });
    expect(judged).toEqual({ eur: 1.25, from: true });
  });
});
