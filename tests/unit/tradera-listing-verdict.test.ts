import { describe, expect, it } from "vitest";
import { traderaRuleVerdict } from "@/lib/tradera-listing-verdict";
import { listingContradiction } from "@/lib/tradera-listing-contradictions";

const SETS = ["Celebrations", "151", "Evolutions", "Legendary Collection", "HS Unleashed", "Ascended Heroes", "Silver Tempest", "Astral Radiance"];
const v = (catalogTitle: string, catalogCategory: string, listingTitle: string, description = "") =>
  traderaRuleVerdict({ catalogTitle, catalogCategory, listingTitle, description }, SETS);

describe("Tradera-regeldomen (utan AI) — fall ur granskningsfacit", () => {
  it("annat set i titeln på en setbunden produkt fälls", () => {
    expect(v("Silver Tempest Elite Trainer Box", "ETB", "Pokémon Astral Radiance ETB oöppnad")).toMatch(/annat set/);
  });

  it("eranamn och eraprefix är inget annat set", () => {
    // "Mega Evolutions" är eran, inte setet Evolutions.
    expect(v("Ascended Heroes Booster Bundle", "BUNDLE", "Pokemon Mega Evolution Ascended Heroes Booster Bundle", "Mega Evolutions Ascended Heros Booster bundle, förseglad")).toBeNull();
    // Katalogen skriver "Unleashed", annonsen "HS Unleashed".
    expect(v("Unleashed Booster", "BOOSTER_PACK", "Pokemon HS Unleashed Booster Pack", "Oöppnad boosterförpackning.")).toBeNull();
    expect(v("Battle Styles Booster Box", "BOOSTER_BOX", "Pokemon Battle Styles Sword & Shield Booster Box", "Innehåller 36st booster packs.")).toBeNull();
  });

  it("en samlarbox får nämna andra set (paketen inuti)", () => {
    expect(v("Unova Heavy Hitters Premium Collection", "COLLECTION_BOX", "Unova Heavy Hitters Premium Collection", "Innehåller boosters från 151 och Celebrations.")).toBeNull();
  });

  it("Pokémon Center-stad, temadeck och Charizard X/Y måste stämma", () => {
    expect(listingContradiction("Pokémon Center Fukuoka Special Box", "COLLECTION_BOX", "Pokémon Center Tohoku Special Box", "")).toMatch(/Pokémon Center/);
    expect(listingContradiction("Growth Clash Theme Deck", "THEME_DECK", "Ember Spark Theme Deck", "")).toMatch(/temadeck/);
    expect(listingContradiction("Mega Charizard X ex Premium Collection", "COLLECTION_BOX", "Mega Charizard Premium Collection", "Charizard Y ex promo")).toMatch(/Charizard/);
  });

  it("US-version, flera exemplar och halv display fälls", () => {
    expect(listingContradiction("Team Rocket Tins: Mewtwo ex Tin (US Version)", "TIN", "Team Rocket Tin Mewtwo ex", "Sealed")).toMatch(/US-version/);
    expect(listingContradiction("Team Rocket Tins: Mewtwo ex Tin (US Version)", "TIN", "Team Rocket Mewtwo Tin (US Version) x 2", "")).toMatch(/flera/);
    expect(listingContradiction("Surging Sparks Booster Box", "BOOSTER_BOX", "Surging Sparks Half Display", "18 boosters")).toMatch(/halv/);
  });

  it("Shadowless/1st Edition bara på WOTC-eran — sökordslistor fäller inte", () => {
    expect(listingContradiction("Base Set Booster", "BOOSTER_PACK", "Base Set Booster 1st Edition", "")).toMatch(/tryckning/);
    expect(listingContradiction("Team Rocket's Mewtwo ex Box", "COLLECTION_BOX", "Team Rocket's Mewtwo ex Box", "Sökord: Base set, Jungle, 1st edition")).toBeNull();
  });

  it("skugglägets missar 10-16: japansk titel, '6x' framför ett pack, förvaringslåda", () => {
    const en = (catalogTitle: string, catalogCategory: string, listingTitle: string) =>
      traderaRuleVerdict({ catalogTitle, catalogCategory, listingTitle, description: "", catalogLanguage: "EN" }, SETS);
    expect(en("30th Celebration Espeon ex and Umbreon ex Premium Deck Set", "COLLECTION_BOX", "Pokémon 30th Celebration Premium Deck Set Espeon & Umbreon Japansk")).toMatch(/japanska/);
    expect(en("Nihil Zero Booster", "BOOSTER_PACK", "Pokemon Nihil Zero (Munikis Zero) Booster Pack (JP M3)")).toMatch(/japanska/);
    expect(en("Storm Emeralda Booster Box", "BOOSTER_BOX", "Pokémon TCG Japanese M6 Storm Emeralda Sealed Booster Box")).toMatch(/japanska/);
    expect(v("Phantasmal Flames Sleeved Booster", "BOOSTER_PACK", "6x Mega Evolution Phantasmal Flames Sleeved Booster Pack")).toMatch(/flera paket/);
    expect(v("Team Rocket's Mewtwo ex Box", "COLLECTION_BOX", "Förvaringslåda Pokémon Team Rocket Mewtwo")).toMatch(/förvaringslåda/);
    // "2 x … Booster Box" är facit-godkänt (pris per styck) — antalsregeln gäller bara pack.
    expect(v("Phantasmal Flames Booster Box", "BOOSTER_BOX", "2 x Phantasmal Flames Booster Box", "Sealed")).toBeNull();
  });

  it("en vanlig förseglad annons passerar", () => {
    expect(v("151 Elite Trainer Box", "ETB", "Pokemon 151 Elite Trainer Box", "Perfect condition / new / sealed. Elite Trainer Box från Scarlet & Violet 151.")).toBeNull();
  });
});
