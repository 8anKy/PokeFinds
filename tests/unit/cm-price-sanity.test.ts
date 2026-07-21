import { describe, it, expect } from "vitest";
import {
  sanePriceEur,
  saneDayMove,
  priceFromGuide,
  lowIsCredible,
} from "../../src/jobs/cardmarket-refresh";

// Regression 2026-07-21: sealed-fasen dömde CM:s From mot TRENDEN, fast 0.2x-golvet
// är kalibrerat mot 30-dagssnittet. På en stigande marknad kastades en äkta From och
// vi publicerade trenden som butikspris. GOLVET vägs nu mot lägsta referensen; TAKET
// är oförändrat mot trenden (att relaxera taket skadade mätbart — se funktionen).
describe("lowIsCredible", () => {
  it("godtar en From som ligger över snittets golv fast trenden sprungit iväg", () => {
    // Prismatic Evolutions Poster Collection: From 35 €, snitt 72,45 €, trend 186 €.
    // Gammalt golv (0.2 × trend) = 37,2 → underkänd. Nytt golv (0.2 × 72,45) = 14,5 → godkänd.
    expect(lowIsCredible(35, 72.45, 186.09)).toBe(true);
    // EX Team Rocket Returns Booster: korrupt trend på tunn vintage.
    expect(lowIsCredible(15, 9.23, 1171.66)).toBe(true);
  });

  it("godtar en hög From som ryms under trendens tak fast snittet är underskattat", () => {
    // Tunn vintage: snittet missar med 3-4x, trenden träffar.
    expect(lowIsCredible(2800, 1170, 2850)).toBe(true);
  });

  it("TAKET är oförändrat — en From långt över trenden förkastas fortfarande", () => {
    // Felmatchad offer: Riolu-tin länkad till ett ETB-case, From 2 200 € mot trend 20 €.
    expect(lowIsCredible(2200, 1249.16, 20.21)).toBe(false);
    // Dollar Tree 3-korts repack: From 15 € mot trend 3,78 €.
    expect(lowIsCredible(15, 31.49, 3.78)).toBe(false);
    // Paradox Rift Booster 2026-07-03: From 9,9 € mot trend 4,9 € (2,0x).
    expect(lowIsCredible(9.9, 4.91, 4.9)).toBe(false);
  });

  it("förkastar en micro-From (under båda golven)", () => {
    expect(lowIsCredible(0.03, 302.86, 300)).toBe(false);
    expect(lowIsCredible(0, 50, 50)).toBe(false);
    expect(lowIsCredible(null, 50, 50)).toBe(false);
  });

  it("släpper igenom när ingen referens finns alls", () => {
    expect(lowIsCredible(5, null, null)).toBe(true);
  });
});

// EN-guide-fallback (2026-07-17): EN-sealed vars idProduct saknas i RapidAPI (Trick or Trade,
// vintage) prissätts direkt från CM:s prisguide. priceFromGuide bär From→trend→30d + sanePriceEur.
describe("priceFromGuide", () => {
  const g = (low: number | null, trend: number | null, avg: number | null = null) =>
    ({ idProduct: 1, low, trend, avg }) as any;

  it("använder From (low) när den är rimlig → accepted (IN_STOCK)", () => {
    expect(priceFromGuide(g(39.9, 44.2))).toEqual({ eur: 39.9, accepted: true });
  });
  it("förkastar glitchad hög From (>1.8x trend) → trend, accepted=false (OUT_OF_STOCK)", () => {
    // Rayquaza LV.X-tin: From €1599 vs trend €130 → trend.
    expect(priceFromGuide(g(1599, 130.14))).toEqual({ eur: 130.14, accepted: false });
  });
  it("faller tillbaka på trend när From saknas → accepted=false", () => {
    expect(priceFromGuide(g(null, 25.6))).toEqual({ eur: 25.6, accepted: false });
  });
  it("behandlar mikro-From (< 0,5 €) som saknad → trend", () => {
    // "151: Costco 5-Pack Mini Tin Bundle" trend 0,02 € = korrupt golv → usable filtrerar bort.
    expect(priceFromGuide(g(0.3, 44))).toEqual({ eur: 44, accepted: false });
  });
  it("null när guiden saknar användbar data helt", () => {
    expect(priceFromGuide(g(null, null, null))).toBeNull();
    expect(priceFromGuide(undefined)).toBeNull();
    expect(priceFromGuide(g(0.02, 0.02))).toBeNull(); // allt under golvet
  });
});

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
