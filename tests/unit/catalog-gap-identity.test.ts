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
  isRarityOnlyLabel,
  cmIdFitsNumberOrder,
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
    const or = (and[0] as { OR: unknown[] }).OR;
    expect(or.slice(0, 2)).toEqual([{ tcgExternalId: null }, { NOT: { tcgExternalId: { startsWith: "cm:" } } }]);
    // Undantaget: unika Cardmarket-only-kort (Card.scannerInclude, satt av build-scanner-unique-cards).
    expect(or[2]).toEqual({ scannerInclude: true });
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
  it("värdefulla kort: ett exemplar under 50 % av lägsta snittet är inget NM-pris ⇒ uppskattning", () => {
    expect(cmOnlyGuidePrice({ low: 3, trend: 43.5, avg: 50, avg30: 15.5, avg7: 15.5 })).toEqual({ eur: 43.5, live: false });
    // Ancient Mew (275577): low 19,95 € är ett Poor-exemplar — försäljningarna ligger på 78–110 €.
    expect(cmOnlyGuidePrice({ low: 19.95, trend: 78.29, avg: 108.98, avg30: 110.04, avg7: 84.23 })).toEqual({ eur: 108.98, live: false });
    // en From nära försäljningarna står kvar
    expect(cmOnlyGuidePrice({ low: 9, trend: 32.72, avg: 68, avg30: 15.02, avg7: 23.08 })).toEqual({ eur: 9, live: true });
  });
  it("en low långt över allt som säljs är ett utrop ⇒ uppskattning (samma regel som singlarna)", () => {
    // Rare Candy · League Promos: 2 000 € mot försäljningar ≤ 65,89 €.
    expect(cmOnlyGuidePrice({ low: 2000, trend: 60, avg: 65.89, avg30: 55, avg7: 60, avg1: 60 })).toEqual({ eur: 60, live: false });
    // Kiawe (JP): 49,99 € mot 0,20 € — under 2 €-gränsen, där den låga vakten annars släpper allt.
    expect(cmOnlyGuidePrice({ low: 49.99, trend: 0.2, avg: 0.2, avg30: 0.2, avg7: 0.2, avg1: 0.2 })).toEqual({ eur: 0.2, live: false });
    // 10x men bara 9 € över ⇒ inget utrop (billigaste annonsen som finns).
    expect(cmOnlyGuidePrice({ low: 10, trend: 0.5, avg: 0.5, avg30: 0.5 })).toEqual({ eur: 10, live: true });
    // Dubbla priset är en NM-premie, inget utrop (Kommo-o STAFF 50 € mot 24,99 €).
    expect(cmOnlyGuidePrice({ low: 50, trend: 24.99, avg: 20, avg30: 24.99, avg7: 24.99 })).toEqual({ eur: 50, live: true });
    // En ensam annons utan försäljningssnitt går inte att döma — står kvar.
    expect(cmOnlyGuidePrice({ low: 500, trend: null, avg: null, avg30: null, avg7: null })).toEqual({ eur: 500, live: true });
  });
  it("utan low ⇒ uppskattning, utan något ⇒ null", () => {
    expect(cmOnlyGuidePrice({ trend: 96.98, avg: 106.98, avg30: 99.69 })).toEqual({ eur: 99.69, live: false });
    expect(cmOnlyGuidePrice({})).toBeNull();
    // Bara ett ensamt avg (inga annonser, inga affärer) ⇒ inget pris (Pikachu XY-P7af, 100 000 €).
    expect(cmOnlyGuidePrice({ low: null, trend: null, avg: 100000, avg30: null, avg7: null })).toBeNull();
    expect(cmOnlyGuidePrice(null)).toBeNull();
  });
});

/**
 * Japanska nummerhål 2026-11-25: 58 ordinarie VSTAR Universe-kort saknades för att CardTrader
 * skriver sällsyntheten i versionsfältet, och fyra för att CT bär italienska tränarnamn.
 */
describe("japanskt nummerhål: sällsynthet är ingen tryckning, och id-ordningen bevisar numret", () => {
  it("rena sällsynthetsord är det vanliga kortet", () => {
    for (const l of ["Ultra Rare", "Shiny Rare", "Holo Rare", "Full-Art", "Full Art", "Gold Secret Rare", "Secret Rare", "SAR", "Special Art Rare"])
      expect(isRarityOnlyLabel(l), l).toBe(true);
  });
  it("stämplar, mönster och utgåvor är EGNA tryckningar", () => {
    for (const l of ["Destined Rivals Stamp", "Prerelease", "Cosmos Holo", "Master Ball Reverse Holo", "Staff", "Pokémon Center", "SVP 190", "Winner", "25th Anniversary", "Japanese", "Holo", "Non-Holo", ""])
      expect(isRarityOnlyLabel(l), l).toBe(false);
  });
  it("id:t måste ligga mellan närmaste länkade grannar — och båda måste finnas", () => {
    const linked = new Map([[156, 687718], [158, 687720], [161, 687723], [164, 687726]]);
    expect(cmIdFitsNumberOrder(157, 687719, linked)).toBe(true);
    // 162 och 163 saknas båda: närmaste grannar är 161 och 164.
    expect(cmIdFitsNumberOrder(162, 687724, linked)).toBe(true);
    expect(cmIdFitsNumberOrder(157, 687721, linked)).toBe(false); // över grannen ovanför
    expect(cmIdFitsNumberOrder(157, 600000, linked)).toBe(false); // under grannen nedanför
    expect(cmIdFitsNumberOrder(170, 687730, linked)).toBe(false); // ingen granne ovanför ⇒ inget bevis
    expect(cmIdFitsNumberOrder(1, 687000, linked)).toBe(false); // ingen granne nedanför
    // Namnen håller med ⇒ en saknad granne är inget motbevis, men en granne på fel sida är det.
    expect(cmIdFitsNumberOrder(170, 687730, linked, false)).toBe(true);
    expect(cmIdFitsNumberOrder(170, 687000, linked, false)).toBe(false);
  });
});
