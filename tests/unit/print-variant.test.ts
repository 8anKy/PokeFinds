import { describe, it, expect } from "vitest";
import {
  PRINT_FIRST_EDITION,
  PRINT_SHADOWLESS,
  PRINT_UNLIMITED,
  isPrintVariantLabel,
  printLabelFromVersion,
  printLabelInTitle,
  printRank,
  VARIANT_REVERSE_HOLO,
  listingFitsVariant,
  titleSaysReverseHolo,
} from "../../src/lib/print-variant";
import { matchListingToProduct } from "../../src/scrapers/matching";

// Base trycktes i tre omgångar och de är olika varor: samma Ponyta kostar 26,50 €
// (1st Edition Shadowless), 4,29 € (Shadowless) eller några ören (Unlimited).
// Katalogen håller en produkt per tryckning; RapidAPI:s `version` är källan.

describe("printLabelFromVersion", () => {
  it("läser RapidAPI:s tre etiketter", () => {
    expect(printLabelFromVersion("Unlimited")).toBe(PRINT_UNLIMITED);
    expect(printLabelFromVersion("Shadowless")).toBe(PRINT_SHADOWLESS);
    expect(printLabelFromVersion("1st Edition")).toBe(PRINT_FIRST_EDITION);
  });

  it("'1st Edition Shadowless' är 1st Edition — ordningen är inte valfri", () => {
    // Testas mot /shadowless/ först skulle Base dyraste tryckning (26,50 €) hamna
    // på shadowless-produkten (4,29 €).
    expect(printLabelFromVersion("1st Edition Shadowless")).toBe(PRINT_FIRST_EDITION);
  });

  it("moderna etiketter är INTE tryckningar", () => {
    expect(printLabelFromVersion(null)).toBeNull();
    expect(printLabelFromVersion("Reverse Holo")).toBeNull();
    expect(printLabelFromVersion("Staff")).toBeNull();
  });
});

describe("printRank — för kort som INTE är uppdelade", () => {
  it("1st Edition rankas sist, Unlimited/omärkt först", () => {
    expect(printRank("1st Edition")).toBe(0);
    expect(printRank("1st Edition Shadowless")).toBe(0);
    expect(printRank("Shadowless")).toBe(1);
    expect(printRank("Unlimited")).toBe(2);
    expect(printRank(null)).toBe(2);
    expect(printRank("Reverse Holo")).toBe(2);
  });
});

describe("isPrintVariantLabel", () => {
  it("skiljer tryckningar från andra varianter", () => {
    expect(isPrintVariantLabel(PRINT_UNLIMITED)).toBe(true);
    expect(isPrintVariantLabel(PRINT_FIRST_EDITION)).toBe(true);
    expect(isPrintVariantLabel("Specialversion")).toBe(false);
    expect(isPrintVariantLabel("GameStop Promo (Reverse Holo)")).toBe(false);
    expect(isPrintVariantLabel(null)).toBe(false);
  });
});

describe("printLabelInTitle — annonsens egen text", () => {
  it("hittar tryckningen i vanliga säljarformuleringar", () => {
    expect(printLabelInTitle("Charizard Base Set 1st Edition PSA 9")).toBe(PRINT_FIRST_EDITION);
    expect(printLabelInTitle("Charizard base set first edition")).toBe(PRINT_FIRST_EDITION);
    expect(printLabelInTitle("Ponyta 60/102 shadowless")).toBe(PRINT_SHADOWLESS);
    expect(printLabelInTitle("Ponyta 60/102 unlimited")).toBe(PRINT_UNLIMITED);
  });

  it("'1st edition shadowless' är en 1st Edition-annons", () => {
    expect(printLabelInTitle("Machamp 1st edition shadowless")).toBe(PRINT_FIRST_EDITION);
  });

  it("tyst annons → null (anroparen behandlar det som Unlimited)", () => {
    expect(printLabelInTitle("Charizard Base Set 4/102")).toBeNull();
    expect(printLabelInTitle("")).toBeNull();
  });
});

// Regression 2026-07-28: med tre produkter per kort delar de kortnamn OCH
// kortnummer. Singel-identiteten i matchProduct/matchListingToProduct gav då tre
// LIKA starka träffar (0.9) och fuzzy-poängen fick avgöra — dvs slumpen bestämde
// om en 40-kronorsannons landade på 1st Edition-produkten.
describe("tryckningsvakt i matchListingToProduct", () => {
  const card = { name: "Ponyta", number: "60" };
  const unlimited = { normalizedTitle: normalize("Ponyta Base 60/102 Unlimited"), card, variantLabel: PRINT_UNLIMITED };
  const firstEd = { normalizedTitle: normalize("Ponyta Base 60/102 1st Edition"), card, variantLabel: PRINT_FIRST_EDITION };
  const shadowless = { normalizedTitle: normalize("Ponyta Base 60/102 Shadowless"), card, variantLabel: PRINT_SHADOWLESS };

  function normalize(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  it("tyst annons matchar BARA Unlimited", () => {
    const listing = "Ponyta 60/102 Base Set";
    expect(matchListingToProduct(listing, unlimited)).toBeGreaterThan(0);
    expect(matchListingToProduct(listing, firstEd)).toBeNull();
    expect(matchListingToProduct(listing, shadowless)).toBeNull();
  });

  it("annons som säger 1st Edition matchar BARA 1st Edition", () => {
    const listing = "Ponyta 60/102 Base Set 1st Edition";
    expect(matchListingToProduct(listing, firstEd)).toBeGreaterThan(0);
    expect(matchListingToProduct(listing, unlimited)).toBeNull();
    expect(matchListingToProduct(listing, shadowless)).toBeNull();
  });

  it("produkter UTAN tryckningsetikett påverkas inte", () => {
    const plain = { normalizedTitle: normalize("Ponyta Base 60/102"), card, variantLabel: null };
    expect(matchListingToProduct("Ponyta 60/102 Base Set", plain)).toBeGreaterThan(0);
    // Även en annons som nämner en tryckning får matcha det odelade kortet: de nio
    // andra WOTC-seten har bara EN katalogpost per kort.
    expect(matchListingToProduct("Ponyta 60/102 Base Set 1st Edition", plain)).toBeGreaterThan(0);
  });
});

describe("reverse holo som variant (2026-08-03)", () => {
  const card = { name: "Koraidon", number: "47" };
  const title = "koraidon pitch black 47 84";
  const reverse = { normalizedTitle: title, card, variantLabel: VARIANT_REVERSE_HOLO };
  const plain = { normalizedTitle: title, card, variantLabel: null };

  it("⛔ en annons som INTE säger reverse får inte prissätta reverse-produkten", () => {
    // Fältfallet: produktsidan visade "Lägsta pris · Tradera 3 kr" på reverse-
    // varianten från en annons för det vanliga kortet (basversionen: 0,22 kr).
    const listing = "Koraidon 047/084 - Pitch Black - Pokémonkort";
    expect(matchListingToProduct(listing, reverse)).toBeNull();
    expect(matchListingToProduct(listing, plain)).toBeGreaterThan(0);
  });

  it("en annons som säger reverse holo landar på reverse-produkten, inte på baskortet", () => {
    const listing = "Koraidon 047/084 Pitch Black Reverse Holo Pokemonkort";
    expect(matchListingToProduct(listing, reverse)).toBeGreaterThan(0);
    expect(matchListingToProduct(listing, plain)).toBeNull();
  });

  it("⛔ KORT SOM HETER 'Reverse …' får inte läsas som en tryckningsuppgift", () => {
    // "Reverse Valley" (Team Up) och "Reverse Energy Removal 2" (EX Ruby &
    // Sapphire) är kortNAMN. Utan namnstrippningen kastas annonsen från sin egen
    // produkt.
    expect(titleSaysReverseHolo("Reverse Valley 118/181 Team Up", "Reverse Valley")).toBe(false);
    expect(
      titleSaysReverseHolo("Reverse Energy Removal 2 80/109 EX Ruby & Sapphire", "Reverse Energy Removal 2")
    ).toBe(false);
    // Men samma kort SOM reverse holo säger det fortfarande.
    expect(titleSaysReverseHolo("Reverse Valley 118/181 Team Up Reverse Holo", "Reverse Valley")).toBe(true);
  });

  it("stavningsvarianter räknas", () => {
    expect(titleSaysReverseHolo("Pikachu 5/100 rev holo")).toBe(true);
    expect(titleSaysReverseHolo("Pikachu 5/100 REVERSE")).toBe(true);
    expect(titleSaysReverseHolo("Pikachu 5/100 holo rare")).toBe(false);
  });

  it("okända etiketter (Staff, Specialversion) beter sig som förut", () => {
    expect(listingFitsVariant("Staff", "Pikachu 5/100", "Pikachu")).toBe(true);
  });
});
