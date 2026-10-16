import { describe, expect, it } from "vitest";
import {
  NON_EN_JP_EXPANSION,
  ballExpansion,
  blueprintLanguage,
  enProductTitle,
  numberKey,
  numbersCarryOwnTotal,
  setNameContained,
  versionLabel,
  winningSet,
  cmOnlyGuidePrice,
} from "@/lib/catalog-gap-identity";
import { episodeSetFromVotes } from "@/jobs/cardmarket-refresh";
import { SCANNER_INCLUDED_CARD } from "@/lib/scanner-exclusion";

/**
 * Kataloglucorna 2026-10-15: Prize Pack-seten (prisleverantören), stämplade tryckningar
 * och japanska startdäck (Cardmarket via CardTraders identitet). Reglerna avgör om ett
 * kort SKAPAS — en miss här är en dubblett i katalogen eller ett felidentifierat kort.
 */
describe("Prize Pack-nummer bär originalsetets nämnare", () => {
  it("titeln får ingen andra nämnare", () => {
    expect(enProductTitle("Meganium", "Play! Pokémon Prize Pack Series Nine", "10/132", 80)).toBe(
      "Meganium · Play! Pokémon Prize Pack Series Nine 10/132"
    );
    expect(enProductTitle("Pikachu ex", "30th Celebration", "149", 191)).toBe("Pikachu ex · 30th Celebration 149/191");
  });
  it("setets tryckta total blir okänd när korten bär egna nämnare", () => {
    expect(numbersCarryOwnTotal(["001", "010/132", "011/094", "012/088"])).toBe(true);
    expect(numbersCarryOwnTotal(["1", "2", "3", "TG10"])).toBe(false);
    expect(numbersCarryOwnTotal([])).toBe(false);
  });
});

describe("CardTrader-identitet", () => {
  it("språket ur pokemon_language — bara engelska och japanska", () => {
    const bp = (v: string) => ({ editable_properties: [{ name: "pokemon_language", default_value: v }] });
    expect(blueprintLanguage(bp("en"))).toBe("EN");
    expect(blueprintLanguage(bp("jp"))).toBe("JP");
    expect(blueprintLanguage(bp("zh-CN"))).toBeNull();
    expect(blueprintLanguage({ editable_properties: [] })).toBeNull();
    expect(NON_EN_JP_EXPANSION.test("McDonald's Collection 2018 French")).toBe(true);
    expect(NON_EN_JP_EXPANSION.test("Theme Deck & Blisters Exclusives")).toBe(false);
  });
  it("versionsetiketten utan nummerdelar", () => {
    expect(versionLabel("Destined Rivals Stamp | 229/159")).toBe("Destined Rivals Stamp");
    expect(versionLabel("Cosmos Holo 15/62 | WOTC Employees-Only")).toBe("Cosmos Holo 15/62 · WOTC Employees-Only");
    expect(versionLabel("")).toBe("");
    expect(versionLabel(null)).toBe("");
  });
  it("numret utan nämnare", () => {
    expect(numberKey("002/110")).toBe("2");
    expect(numberKey("SV001")).toBe(numberKey("SV1"));
    expect(numberKey("TG10")).not.toBe(numberKey("10"));
  });
  it("bollmönstren känns igen", () => {
    expect(ballExpansion("Prismatic Evolutions - Poké Ball Reverse Holo")).toEqual({ set: "Prismatic Evolutions", label: "Poké Ball Reverse Holo" });
    expect(ballExpansion("Black Bolt - Master Ball Reverse Holo")).toEqual({ set: "Black Bolt", label: "Master Ball Reverse Holo" });
    expect(ballExpansion("Ascended Heroes - Energy Reverse Holo")).toBeNull();
  });
});

describe("samma utgåva under annat namn skapas aldrig igen", () => {
  it("våra setnamn inneslutna i CardTraders", () => {
    expect(setNameContained("Holon Phantoms", "EX Holon Phantoms")).toBe(true);
    expect(setNameContained("Generations", "Radiant Collection Generation")).toBe(true);
    expect(setNameContained("Pokémon GO", "Pokémon TCG: Pokémon GO")).toBe(true);
    expect(setNameContained("Unseen Forces", "Unown sub-set Unseen Forces")).toBe(true);
    expect(setNameContained("DP Promos (DP-P)", "DP Promos")).toBe(true);
    expect(setNameContained("Mewtwo vs Genesect Deck Kit (Mewtwo) (MGm)", "Mewtwo vs Genesect Deck Kit")).toBe(true);
  });
  it("men ett temadäck är inte originalsetet", () => {
    expect(setNameContained("Destined Rivals", "Theme Deck & Blisters Exclusives")).toBe(false);
    expect(setNameContained("Secret Wonders", "World Championship Decks 2010")).toBe(false);
    expect(setNameContained("Pokémon", "Anything")).toBe(false); // bara stoppord
  });
});

describe("röster väljer set", () => {
  it("≥ 3 röster och ≥ 80 %", () => {
    expect(winningSet(new Map([["a", 9], ["b", 1]]))).toBe("a");
    expect(winningSet(new Map([["a", 2]]))).toBeNull();
    expect(winningSet(new Map([["a", 6], ["b", 4]]))).toBeNull();
    expect(winningSet(undefined)).toBeNull();
    expect(episodeSetFromVotes(new Map([["svp", 190], ["other", 2]]))).toBe("svp");
    expect(episodeSetFromVotes(new Map([["svp", 2]]))).toBeNull();
  });
});

describe("skannerns index", () => {
  it("släpper igenom kort UTAN tcgExternalId (NOT över en nullbar kolumn hade fällt dem)", () => {
    const and = (SCANNER_INCLUDED_CARD as { AND: unknown[] }).AND;
    expect(and[0]).toEqual({ OR: [{ tcgExternalId: null }, { NOT: { tcgExternalId: { startsWith: "cm:" } } }] });
    expect(and[1]).toEqual({ NOT: { set: { name: { startsWith: "Play! Pokémon Prize Pack" } } } });
  });
});

describe("pris för kort som bara finns på Cardmarket", () => {
  it("prisguidens low = Cardmarkets From (Marnie's Morpeko svOM 020: 13,38 €) — en levande annons", () => {
    expect(cmOnlyGuidePrice({ low: 13.38, trend: 15.86, avg: 20.93, avg30: 21.8 })).toEqual({ eur: 13.38, live: true });
  });
  it("billiga kort: low ÄR From (0,03 € för en common) — ingen vakt under 2 €", () => {
    expect(cmOnlyGuidePrice({ low: 0.03, trend: 0.42, avg: 0.34, avg30: 0.33 })).toEqual({ eur: 0.03, live: true });
  });
  it("värdefulla kort: ett exemplar under 25 % av lägsta snittet är skadat ⇒ uppskattning", () => {
    expect(cmOnlyGuidePrice({ low: 3, trend: 43.5, avg: 50, avg30: 15.5, avg7: 15.5 })).toEqual({ eur: 43.5, live: false });
    // men ett brusigt högt trendtal fäller inte en rimlig From (Charizard ex JP: 4,95 mot avg30 15,02)
    expect(cmOnlyGuidePrice({ low: 4.95, trend: 32.72, avg: 68, avg30: 15.02, avg7: 23.08 })).toEqual({ eur: 4.95, live: true });
  });
  it("utan low ⇒ uppskattning, utan något ⇒ null", () => {
    expect(cmOnlyGuidePrice({ trend: 96.98, avg: 106.98, avg30: 99.69 })).toEqual({ eur: 99.69, live: false });
    expect(cmOnlyGuidePrice({})).toBeNull();
    // Bara ett ensamt avg (inga annonser, inga affärer) ⇒ inget pris (Pikachu XY-P7af, 100 000 €).
    expect(cmOnlyGuidePrice({ low: null, trend: null, avg: 100000, avg30: null, avg7: null })).toBeNull();
    expect(cmOnlyGuidePrice(null)).toBeNull();
  });
});
