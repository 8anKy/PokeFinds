import { describe, expect, it } from "vitest";
import {
  isMerchandiseListing,
  isSingleCardListing,
  nearestCatalogCandidate,
  type MatchIndex,
} from "@/scrapers/matching";
import { wooPriceOre } from "@/scrapers/adapters/woocommerce-adapter";
import { normalizeTitle } from "@/lib/utils";

/**
 * Vakterna som stoppar de nya butikernas icke-TCG-sortiment från att bli
 * katalogprodukter. Båda hålen upptäcktes genom att MÄTA de riktiga feedarna
 * (2026-08-07), inte genom att läsa koden — och båda är tysta i drift: en singel
 * eller ett gosedjur som slinker igenom blir bara ännu en produkt i katalogen.
 */
describe("isSingleCardListing — samlarnummer/total", () => {
  it("flaggar de titlar som fällde provkörningen", () => {
    // Ur Pocketmonsters och TCG Stores riktiga feedar.
    for (const t of [
      "Japansk drakit VSTAR 050/071",
      "Gapejaw Bog 213/195 Hemlig Sällsynt",
      "Raihan TG27/TG30 Fullständig bild",
      "Charmander Cosmos Holofoil - 004/165 - Pokémon Scarlet & Violet: 151",
      "Mewtwo AR - 183/165 - Pokémon Scarlet & Violet: 151 (sv2a)",
      "Ninetales AR - sv3 #110/108 - Pokémon: Ruler Of The Black Flame",
    ]) {
      expect(isSingleCardListing(t), t).toBe(true);
    }
  });

  it("rör INTE riktiga sealed-titlar", () => {
    // 0 av 1 466 feed-titlar och 0 av 1 633 katalogprodukter träffades vid mätningen.
    for (const t of [
      "Pokémon: Scarlet & Violet - Destined Rivals Booster Box",
      "Pokémon TCG: Pitch Black M5 3-Pack Blister (Binacle)",
      "Pokémon Mega Evolution Mega Greninja EX Premium Collection",
      "Pokémon: Ascended Heroes ex Box (Mega Meganium / Emboar / Feraligatr)",
      "Pokemon Mega: Dream ex Booster Box (Japansk)",
      "Stellar Miracle Booster Pack (Japansk)",
      "Pokémon Mega Evolution: Chaos Rising 3-Pack Blister (ME04)",
    ]) {
      expect(isSingleCardListing(t), t).toBe(false);
    }
  });

  it("tar inte årtal eller bråk för samlarnummer", () => {
    expect(isSingleCardListing("Pokémon Kalender 2024/2025")).toBe(false);
    expect(isSingleCardListing("Booster Box till 1/2 pris")).toBe(false);
  });
});

describe("isMerchandiseListing", () => {
  it("flaggar leksaksbutikens sortiment", () => {
    for (const t of [
      "Pokémon Gosedjur Pikachu 30cm",
      "Pokemon figur Charizard",
      "Pokémon affisch Kanto",
      "Pokemon T-shirt barn",
      "Pokemon pussel 1000 bitar",
    ]) {
      expect(isMerchandiseListing(t), t).toBe(true);
    }
  });

  it("SEALED-ORDET VETAR — en riktig SKU med merch-ord släpps igenom", () => {
    // Asymmetrin är avsiktlig: ett falskt merch-ord kostar ingenting, ett glömt
    // kostar en katalogprodukt.
    for (const t of [
      "Pokémon TCG: Mew ex Ultra-Premium Collection (figur ingår)",
      "Pokémon Mega Evolution Tin med Poké Ball figur",
      "Pokémon TCG Adventskalender 2025",
      "Pokémon Julkalender med boosterpaket",
    ]) {
      expect(isMerchandiseListing(t), t).toBe(false);
    }
  });

  it("bart 'ball' är inte merch — Poké Ball är ett riktigt trainer-kort", () => {
    expect(isMerchandiseListing("Poké Ball")).toBe(false);
  });
});

describe("wooPriceOre — minor units", () => {
  it("läser priset i butikens egen minsta enhet", () => {
    // The Swedish Fish: "129900" med minor_unit 2 = 1 299,00 kr = 129 900 öre.
    expect(wooPriceOre({ price: "129900", currency_code: "SEK", currency_minor_unit: 2 })).toBe(129900);
    // En butik med minor_unit 0 anger hela kronor.
    expect(wooPriceOre({ price: "1299", currency_code: "SEK", currency_minor_unit: 0 })).toBe(129900);
    // Saknad minor_unit → anta 2 (Store API:ts standard).
    expect(wooPriceOre({ price: "129900", currency_code: "SEK" })).toBe(129900);
  });

  it("vägrar allt som inte är SEK", () => {
    // Jobben kör i ett US-datacenter; en multivaluta-butik kan svara i EUR.
    expect(wooPriceOre({ price: "12990", currency_code: "EUR", currency_minor_unit: 2 })).toBeNull();
  });

  it("0 kr är inget pris", () => {
    expect(wooPriceOre({ price: "0", currency_code: "SEK", currency_minor_unit: 2 })).toBeNull();
    expect(wooPriceOre({ price: "", currency_code: "SEK", currency_minor_unit: 2 })).toBeNull();
    expect(wooPriceOre(undefined)).toBeNull();
  });
});

/**
 * Andra chansen: hittar den kandidat som ska skickas till LLM-domaren när
 * `matchProduct` avstått. Funktionen VÄLJER inte — den får inte utesluta den rätta
 * tvillingen, och den får inte föreslå en vara som bevisligen är något annat.
 */
describe("nearestCatalogCandidate", () => {
  const catalog = (...titles: string[]): MatchIndex =>
    titles.map((t, i) => ({ id: `p${i}`, normalizedTitle: normalizeTitle(t), card: null }));

  function nearest(listing: string, index: MatchIndex, min = 0.75) {
    const hit = nearestCatalogCandidate(normalizeTitle(listing), listing, index, min);
    return hit ? index.find((c) => c.id === hit.id)!.normalizedTitle : null;
  }

  it("hittar tvillingen bakom butikens stavfel", () => {
    // Uppmätt fall: nonEraCoverage blev 0,000 för att kandidaten saknar icke-era-ord
    // helt, så matchProduct sa null trots Dice 0,945.
    const index = catalog("Scarlet & Violet Booster Pack", "Scarlet & Violet Booster Box");
    expect(nearest("Scarlet of Violet Booster pack", index)).toBe(normalizeTitle("Scarlet & Violet Booster Pack"));
  });

  it("väljer rätt av två som ligger 0,014 isär", () => {
    // Marginalvakten gav null här. En påse är inte en sleeved booster.
    const index = catalog("Scarlet Violet Destined Rivals Booster Pack", "Destined Rivals Sleeved Booster");
    expect(nearest("Destined Rivals Booster Pack", index)).toBe(
      normalizeTitle("Scarlet Violet Destined Rivals Booster Pack")
    );
  });

  it("en PÅSE föreslås aldrig mot en BOX", () => {
    const index = catalog("Destined Rivals Booster Box");
    expect(nearest("Destined Rivals Booster Pack", index)).toBeNull();
  });

  it("föreslår aldrig ett enskilt KORT för en sealed-annons", () => {
    const index: MatchIndex = [
      { id: "c1", normalizedTitle: normalizeTitle("Charizard ex Booster Box"), card: { name: "Charizard ex", number: "6" } },
    ];
    expect(nearest("Charizard ex Booster Box", index)).toBeNull();
  });

  it("respekterar de tvåsidiga vakterna (Premium ≠ Super-Premium)", () => {
    const index = catalog("Prismatic Evolutions Premium Figure Collection");
    expect(nearest("Prismatic Evolutions Super-Premium Collection", index)).toBeNull();
  });

  it("tiger när ingenting är i närheten — då är ny produkt rätt svar", () => {
    const index = catalog("Scarlet & Violet Booster Pack", "Destined Rivals Booster Box");
    expect(nearest("Ninja Spinner Box", index)).toBeNull();
  });

  it("golvet stänger ute avlägsna par", () => {
    const index = catalog("Pokemon Mega: Storm Emeralda Booster Box (Japansk)");
    // 0,565 — under golvet, alltså frågas domaren aldrig.
    expect(nearest("Storm Emerald Booster Box (Förbeställning)", index)).toBeNull();
  });
});
