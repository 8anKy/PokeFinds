import { describe, it, expect } from "vitest";
import {
  qualityScore,
  qualityScoreInt,
  relevanceScore,
  personalBoost,
  bestMatchScore,
  EMPTY_PERSONAL,
  type QualityInput,
  type BestMatchItem,
} from "../../src/services/ranking";

const NOW = new Date("2026-07-29T00:00:00Z");

const quality = (over: Partial<QualityInput> = {}): QualityInput => ({
  engagement30d: 0,
  watchers: 0,
  inStockCount: 0,
  offerCount: 1,
  hasImage: true,
  hasPrice: true,
  setReleaseDate: null,
  now: NOW,
  ...over,
});

describe("qualityScore", () => {
  it("belönar köpbarhet: samma produkt i lager slår samma produkt slutsåld", () => {
    expect(qualityScore(quality({ inStockCount: 2 }))).toBeGreaterThan(
      qualityScore(quality({ inStockCount: 0 }))
    );
  });

  it("straffar en post utan pris hårdare än den belönar en bild", () => {
    const utanPris = qualityScore(quality({ hasPrice: false }));
    const utanBild = qualityScore(quality({ hasImage: false }));
    expect(utanPris).toBeLessThan(utanBild);
  });

  it("dämpar engagemang logaritmiskt — 500 visningar är inte 10x bättre än 50", () => {
    const femtio = qualityScore(quality({ engagement30d: 50 }));
    const femhundra = qualityScore(quality({ engagement30d: 500 }));
    expect(femhundra).toBeGreaterThanOrEqual(femtio);
    expect(femhundra - femtio).toBeLessThan(0.02);
  });

  it("ger färskhetsbonus till nya set men inget till gamla", () => {
    const nytt = qualityScore(quality({ setReleaseDate: new Date("2026-07-01T00:00:00Z") }));
    const gammalt = qualityScore(quality({ setReleaseDate: new Date("1999-01-09T00:00:00Z") }));
    expect(nytt).toBeGreaterThan(gammalt);
  });

  it("är aldrig negativ ens när allt saknas", () => {
    expect(
      qualityScore(quality({ hasPrice: false, hasImage: false, offerCount: 0 }))
    ).toBeGreaterThanOrEqual(0);
  });

  it("heltalsformen är poängen × 1000", () => {
    const q = quality({ engagement30d: 12, inStockCount: 1 });
    expect(qualityScoreInt(q)).toBe(Math.round(qualityScore(q) * 1000));
  });
});

describe("relevanceScore", () => {
  const item = (over: Partial<Parameters<typeof relevanceScore>[0]> = {}) => ({
    query: "charizard",
    title: "Charizard · Base 4/102",
    cardName: "Charizard",
    cardNumber: "4",
    setName: "Base",
    ...over,
  });

  it("kortet självt slår en ask som bara nämner kortet", () => {
    const kortet = relevanceScore(item());
    const asken = relevanceScore(
      item({ title: "Charizard ex Premium Collection", cardName: null, cardNumber: null, setName: null })
    );
    expect(kortet).toBeGreaterThan(asken);
  });

  it("kortnummer i frågan lyfter rätt kort", () => {
    const med = relevanceScore(item({ query: "charizard 4/102" }));
    const fel = relevanceScore(item({ query: "charizard 4/102", cardNumber: "11" }));
    expect(med).toBeGreaterThan(fel);
  });

  it("ledande nollor och snedstreck spelar ingen roll för nummerträffen", () => {
    expect(relevanceScore(item({ query: "charizard 004", cardNumber: "4/102" }))).toBe(
      relevanceScore(item({ query: "charizard 4", cardNumber: "4" }))
    );
  });

  it("SETNAMNS-FÄLLAN: träff enbart via setnamnet trycks ned", () => {
    // "Base" finns i setnamnet men produkten handlar om något helt annat.
    const baraSet = relevanceScore({
      query: "base",
      title: "Secret Box",
      cardName: "Secret Box",
      cardNumber: null,
      setName: "Base",
    });
    const iTiteln = relevanceScore({
      query: "base",
      title: "Base Booster Pack",
      cardName: null,
      cardNumber: null,
      setName: "Base",
    });
    expect(baraSet).toBeLessThan(iTiteln);
  });

  it("tom eller blank fråga ger noll (ingen ordning ska falla ut ur intet)", () => {
    expect(relevanceScore(item({ query: "   " }))).toBe(0);
    expect(relevanceScore(item({ query: "!!!" }))).toBe(0);
  });

  it("är okänslig för versaler och diakritiska tecken", () => {
    expect(relevanceScore(item({ query: "CHARIZARD" }))).toBe(relevanceScore(item()));
    expect(
      relevanceScore(item({ query: "pokemon", title: "Pokémon Center Lady", cardName: "Pokémon Center Lady" }))
    ).toBeGreaterThan(0);
  });
});

describe("personalBoost", () => {
  const ctx = {
    watchedProductIds: new Set(["p1"]),
    ownedProductIds: new Set(["p2"]),
    affinitySetIds: new Set(["s9"]),
  };

  it("bevakad produkt lyfts mest, sedan set-släktskap, sedan ägd", () => {
    const bevakad = personalBoost({ id: "p1", setId: null }, ctx);
    const setSlakt = personalBoost({ id: "p3", setId: "s9" }, ctx);
    const agd = personalBoost({ id: "p2", setId: null }, ctx);
    expect(bevakad).toBeGreaterThan(setSlakt);
    expect(setSlakt).toBeGreaterThan(agd);
  });

  it("okänd produkt får ingenting, och tom kontext lyfter aldrig något", () => {
    expect(personalBoost({ id: "p9", setId: "s1" }, ctx)).toBe(0);
    expect(personalBoost({ id: "p1", setId: "s9" }, EMPTY_PERSONAL)).toBe(0);
  });
});

describe("bestMatchScore", () => {
  const base = (over: Partial<BestMatchItem> = {}): BestMatchItem => ({
    id: "p1",
    setId: "s1",
    title: "Charizard · Base 4/102",
    cardName: "Charizard",
    cardNumber: "4",
    setName: "Base",
    quality: quality(),
    ...over,
  });

  it("utan sökord är ordningen ren kvalitet", () => {
    const bra = bestMatchScore(base({ quality: quality({ inStockCount: 3, engagement30d: 40 }) }));
    const svag = bestMatchScore(base({ quality: quality({ hasPrice: false }) }));
    expect(bra).toBeGreaterThan(svag);
  });

  it("med sökord slår den exakta träffen den populära som knappt matchar", () => {
    const exakt = bestMatchScore(base(), { query: "charizard" });
    const populärMenSvag = bestMatchScore(
      base({
        id: "p2",
        title: "Elite Trainer Box med Charizard-motiv",
        cardName: null,
        cardNumber: null,
        quality: quality({ engagement30d: 500, watchers: 10, inStockCount: 5 }),
      }),
      { query: "charizard" }
    );
    expect(exakt).toBeGreaterThan(populärMenSvag);
  });

  it("personligt lyft ändrar ordningen mellan två annars likvärdiga träffar", () => {
    const personal = {
      watchedProductIds: new Set(["p2"]),
      ownedProductIds: new Set<string>(),
      affinitySetIds: new Set<string>(),
    };
    const a = bestMatchScore(base({ id: "p1" }), { query: "charizard", personal });
    const b = bestMatchScore(base({ id: "p2" }), { query: "charizard", personal });
    expect(b).toBeGreaterThan(a);
  });

  it("en produkt som inte matchar frågan får noll — poängen rankar, den filtrerar inte in", () => {
    const score = bestMatchScore(
      base({ title: "Pikachu VMAX", cardName: "Pikachu VMAX", cardNumber: "44", setName: "Vivid Voltage" }),
      { query: "charizard" }
    );
    expect(score).toBe(0);
  });
});
