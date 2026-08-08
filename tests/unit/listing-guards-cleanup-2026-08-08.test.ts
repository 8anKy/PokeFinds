import { describe, expect, it } from "vitest";
import {
  hasPokemonTitleSignal,
  isAccessoryListing,
  isMerchandiseListing,
  isOtherFranchiseListing,
  isStoreBundleListing,
  isUnspecifiedCharacterListing,
} from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

/**
 * Vakterna som stärktes efter ägarens kataloggenomgång 2026-08-08 (Duplicates.txt):
 * 75 dubbletter och 21 främmande poster hade tagit sig in via de nya butikerna.
 * Varje positivt fall nedan är en RIKTIG titel som blev en felaktig katalogprodukt;
 * varje negativt fall är en riktig SKU som vakten inte får röra.
 */
describe("isOtherFranchiseListing — anime-TCG:er", () => {
  it("flaggar Naruto-boxen som blev katalogprodukt via Pokétalk", () => {
    expect(isOtherFranchiseListing("Naruto Mythos TCG: First Set Special Pack Collection Box")).toBe(true);
  });

  it("rör inte Pokémon-titlar", () => {
    for (const t of [
      "Pokémon TCG: Mega Evolution Booster Box",
      "Team Rocket's Mewtwo ex Box",
      "Pokemon Mega: Dream ex Booster Box (Japansk)",
    ]) {
      expect(isOtherFranchiseListing(t), t).toBe(false);
    }
  });
});

describe("isAccessoryListing — pärm/album ÄVEN med booster (ägarbeslut)", () => {
  it("flaggar portfolio-/albumbundlarna ägaren raderat två gånger", () => {
    for (const t of [
      "Journey Together Booster pack + Mini portfolio",
      "2026 Spring Mini Album with Booster",
      "Pokémon TCG: Scarlet & Violet - Stellar Crown Mini Portfolio + 1 Booster",
    ]) {
      expect(isAccessoryListing(t), t).toBe(true);
    }
  });

  it("flaggar lösa extras och tomma produkter", () => {
    for (const t of [
      "Pokemon Scarlet & Violet 151: Ultra Premium Collection Jumbo Mynt",
      "Pokémon Scarlet & Violet 151: Mini Tin + Art Card & Coin (Boosters ingår ej) - Kadabra & Hitmonlee",
      "Pokémon Display Frame - kort medföljer ej",
    ]) {
      expect(isAccessoryListing(t), t).toBe(true);
    }
  });

  it("rör inte riktiga sealed-SKU:er", () => {
    for (const t of [
      "Hidden Fates Elite Trainer Box",
      "Pokémon TCG: Crown Zenith Booster Pack",
      "Prismatic Evolutions Booster Bundle",
      // "mynt ingår" (utan ej/inte) är ett INNEHÅLLSLÖFTE, inte ett tillbehör.
      "Stellar Crown Checklane Blister - Ancient promos och mynt ingår",
      // Album SÅLT I EN BLISTER är en riktig CM-SKU (mätt mot katalogen 2026-08-08).
      "Guardians Rising: Collector's Album 2-Pack Blister",
      "Goodra Mini Album 2-Pack Blister",
    ]) {
      expect(isAccessoryListing(t), t).toBe(false);
    }
  });
});

describe("hasPokemonTitleSignal — positiv evidens, inte blocklista", () => {
  const sets = new Set(
    ["Wild Force (SV5K)", "Prismatic Evolutions", "Destined Rivals"].flatMap((n) => [
      normalizeTitle(n),
      normalizeTitle(n.replace(/\(.*?\)/g, " ")),
    ])
  );

  it("avvisar okända franchiser som blocklistan aldrig kan känna till", () => {
    // Ägarens plantering 2026-08-08: tog sig in för att ingen blocklista kände den.
    expect(hasPokemonTitleSignal("KPop Demon Hunters Energy Edition Booster Box", sets)).toBe(false);
    expect(hasPokemonTitleSignal("Random New Anime TCG Booster Box", sets)).toBe(false);
  });

  it("släpper igenom Pokémon-evidens av alla fyra slag", () => {
    for (const t of [
      "Pokémon TCG: Something New Booster Box", // ordet
      "Snorlax Premium Figure Box", // Pokémon-namn
      "Wild Force Booster Pack (Japansk) - sv5K", // känt setnamn (utan parentes-koden)
      "Fall 2027 Elite Trainer Box", // Pokémon-exklusiv produktlinje
      "Trick or Trade BOOster Pack 2027",
      "Reshiram-EX Tin", // bindestrecksnamn måste också kännas igen
    ]) {
      expect(hasPokemonTitleSignal(t, sets), t).toBe(true);
    }
  });
});

describe("isMerchandiseListing — Poster Collection är en riktig TCG-SKU", () => {
  it("flaggar inte poster collections (hittad av katalogsvepningen 2026-08-08)", () => {
    for (const t of [
      "Ascended Heroes: Mega Lucario Premium Poster Collection",
      "Prismatic Evolutions Poster Collection",
      "151 Poster Collection",
    ]) {
      expect(isMerchandiseListing(t), t).toBe(false);
    }
  });

  it("en bar affisch är fortfarande merch", () => {
    expect(isMerchandiseListing("Pokémon affisch Kanto")).toBe(true);
    expect(isMerchandiseListing("Pokemon Charizard Poster 50x70")).toBe(true);
  });
});

describe("isStoreBundleListing — sortiment (random/assorted)", () => {
  it("flaggar sortimentslistningarna ur ägarens genomgång", () => {
    for (const t of [
      "Pokémon, Lumiose City, Mini Tin – 1st random Tin",
      "Pokémon Scarlet & Violet 8.5: Prismatic Evolutions Mini Tin - Assorted",
      "Pokemon Paradox Destinies Tin - 1 st random tin",
      "Pokémon Mini Tin - Slumpad",
    ]) {
      expect(isStoreBundleListing(t), t).toBe(true);
    }
  });

  it("rör inte karaktärsspecifika tins", () => {
    for (const t of [
      "Paldean Fates: Tera Charizard ex Tin",
      "Black Bolt & White Flare: Unova Mienshao Mini Tin",
      "Mega Moonlit Tins: Mega Gengar ex Tin",
    ]) {
      expect(isStoreBundleListing(t), t).toBe(false);
    }
  });
});

describe("isUnspecifiedCharacterListing — karaktären ÄR identiteten", () => {
  it("flaggar de generiska blister-/mini tin-titlar som blev dubbletter", () => {
    for (const t of [
      "Pokémon SV6: Twilight Masquerade Premium Checklane Blister",
      "Pokémon SWSH12: Silver Tempest Checklane Blister Pack",
      "Pokémon SV9: Journey Together Blister 3-Pack",
      "Prismatic Evolutions Mini Tin",
      "Pokemon ME01 Mega Evolution Mini Tin",
      "MEGA EVOLUTION – CHAOS RISING BLISTER 3-PACK",
    ]) {
      expect(isUnspecifiedCharacterListing(t), t).toBe(true);
    }
  });

  it("rör inte annonser som namnger karaktären", () => {
    for (const t of [
      "Twilight Masquerade: Kingdra Premium Checklane Blister",
      "Black Bolt & White Flare: Unova Mienshao Mini Tin",
      "Pokémon TCG: Pitch Black M5 3-Pack Blister (Binacle)",
      "Pokemon Ascend Heroes 3-Pack Blister - Gastly",
    ]) {
      expect(isUnspecifiedCharacterListing(t), t).toBe(false);
    }
  });

  it("rör inte former där karaktärslöshet är normal (set-nivå-SKU:er)", () => {
    for (const t of [
      "Surging Sparks Booster Box",
      "Prismatic Evolutions Elite Trainer Box",
      "151 Booster Bundle",
    ]) {
      expect(isUnspecifiedCharacterListing(t), t).toBe(false);
    }
  });

  it("dokumenterat: äkta karaktärslösa SKU:er flaggas OCKSÅ — därför får vakten BARA stå vid skapandet", () => {
    // "Ancient"-blistern är en riktig CM-produkt utan karaktär. Den finns redan i
    // katalogen (CM-importen), så en butiksannons når den via matchningen — vakten
    // hindrar bara att en NY produkt skapas när matchningen misslyckats.
    expect(isUnspecifiedCharacterListing("Stellar Crown: Ancient Premium Checklane Blister")).toBe(true);
  });
});
