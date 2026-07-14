import { describe, it, expect } from "vitest";
import { sanePriceEur, saneDayMove } from "../../src/jobs/cardmarket-refresh";

// Regression: 2026-07-03 gav RapidAPI glitchad micro-lowest (~€0.03) på ~30 sealed
// → 0,33 kr korrumperade offer + prishistorik. Vakten faller tillbaka på 30d-snittet.
describe("sanePriceEur", () => {
  it("använder lowest när den är rimlig (>=20% av 30d-snittet)", () => {
    expect(sanePriceEur(300, 302.86)).toBe(300);
    expect(sanePriceEur(60, 300)).toBe(60); // exakt 20%
  });

  it("förkastar glitchad micro-lowest → 30d-snittet", () => {
    expect(sanePriceEur(0.03, 302.86)).toBe(302.86); // Destined Rivals-buggen
    expect(sanePriceEur(0, 50)).toBe(50);
  });

  it("förkastar glitchad hög lowest (>1.8x snittet) → 30d-snittet", () => {
    expect(sanePriceEur(9.9, 4.91)).toBe(4.91); // Paradox Rift Booster 2026-07-03 (2.0x)
    expect(sanePriceEur(9.1, 5)).toBe(5); // 1.82x → klämt
    expect(sanePriceEur(8.9, 5)).toBe(8.9); // 1.78x → ok (marknad kan stiga lite)
  });

  it("faller tillbaka på snittet när lowest saknas", () => {
    expect(sanePriceEur(null, 42)).toBe(42);
    expect(sanePriceEur(undefined, 42)).toBe(42);
  });

  it("släpper igenom lowest när inget snitt finns att jämföra mot", () => {
    expect(sanePriceEur(5, null)).toBe(5);
  });

  it("null när ingen prisdata alls", () => {
    expect(sanePriceEur(null, null)).toBeNull();
    expect(sanePriceEur(0, null)).toBeNull();
  });
});

// Regression: 2026-07-05 gav RapidAPI 2104 korrupta priser (commons uppblåsta,
// boxar kraschade). Dag-vakten behåller gårdagens värde vid ett hopp ≥3x åt något håll.
describe("saneDayMove", () => {
  it("släpper igenom normala rörelser (<3x)", () => {
    expect(saneDayMove(100, 100)).toBe(100);
    expect(saneDayMove(200, 100)).toBe(200); // 2x ok
    expect(saneDayMove(50, 100)).toBe(50); // halvering ok
  });
  it("klämmer orimliga hopp till gårdagens värde", () => {
    expect(saneDayMove(2309_00, 5)).toBe(5); // common 0,05kr → 2309kr
    expect(saneDayMove(300, 100)).toBe(100); // exakt 3x → klämt
    expect(saneDayMove(2, 3324_00)).toBe(3324_00); // box-krasch till 2 öre
  });
  it("släpper igenom när ingen gårdagsreferens finns", () => {
    expect(saneDayMove(9999, null)).toBe(9999);
    expect(saneDayMove(9999, 0)).toBe(9999);
  });
});

// Regression: dagvakten var en SPÄRRHAKE (2026-07-14). Utan facit avvisade den ÄVEN
// rättelsen av ett redan korrupt pris — skräpet kunde aldrig lämna katalogen.
// Verkliga, uppmätta fall (DB-värde vs live RapidAPI + CM:s egen prisguide).
describe("saneDayMove — självläkning mot CM-trend (refOre)", () => {
  it("släpper igenom ett stort hopp som går MOT facit (rättelse)", () => {
    // Paldean Fates: Skeledirge ex Premium Collection.
    // Frusen på 79 kr; RapidAPI låg = 149,90 € (= CM:s sida "From 149,90 €") → 1 733 kr.
    // CM-trend 142,93 € → 1 652 kr. 21,9x hopp, men rakt mot facit.
    expect(saneDayMove(1733_00, 79_00, 1652_00)).toBe(1733_00);
    // Great Encounters Booster Box: 325 385 kr → 6 712 kr, CM-trend 1 497 € ≈ 17 306 kr.
    expect(saneDayMove(6712_00, 325385_00, 17306_00)).toBe(6712_00);
    // Mega Charizard X ex Tin: 100 kr → 363 kr, CM-trend 30,95 € ≈ 358 kr.
    expect(saneDayMove(363_00, 100_00, 358_00)).toBe(363_00);
  });

  it("klämmer fortfarande ett stort hopp som går BORT från facit (äkta glitch)", () => {
    // RapidAPI-glitchen 2026-07-03: €0.03 på en €300-box. Facit säger 300 € → avvisa.
    expect(saneDayMove(35, 3468_00, 3468_00)).toBe(3468_00);
    // Uppblåst common: 0,05 kr → 2 309 kr medan facit ligger kvar vid 0,05 kr.
    expect(saneDayMove(2309_00, 5, 5)).toBe(5);
  });

  it("beter sig som förr när facit saknas (bakåtkompatibelt)", () => {
    expect(saneDayMove(1733_00, 79_00, null)).toBe(79_00);
    expect(saneDayMove(1733_00, 79_00)).toBe(79_00);
    expect(saneDayMove(1733_00, 79_00, 0)).toBe(79_00);
  });

  it("oavgjort lopp läker INTE — vakten får aldrig hänga på flyttalsbrus", () => {
    // prior 100, ny 900, facit 300: båda ligger exakt 3x från facit. Skillnaden i
    // log-avstånd är 2e-16 (ren flyttalsnoise) → utan marginal blev domen en
    // slantsingling. Konservativt: behåll gårdagens.
    expect(saneDayMove(900, 100, 300)).toBe(100);
  });
});
