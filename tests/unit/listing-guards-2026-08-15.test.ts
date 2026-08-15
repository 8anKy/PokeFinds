/**
 * VAKTHÄRDNINGEN 2026-08-15 — regressionsvakt.
 *
 * BAKGRUND: när `guessListingCategory` lärde sig fler sealed-former (Battle Decks,
 * Build & Battle, Starter Sets, Trainer's Toolkit, kvalificerade Collections) slutade
 * `OTHER` fungera som den olyckliga sista bromsen den varit. MÄTT samma dag mot 42
 * butikers feedar: gosedjur, figurer, godis, myntset, nyckelringar, kortställ,
 * spelarguider, bulk-lotter och HELA Pokétalks singelsortiment passerade VARENDA vakt
 * — de syntes bara inte, eftersom klassificeraren råkade svara OTHER och OTHER är
 * gömd. Det var en slump, inte en vakt.
 *
 * Varje fall nedan kommer ur den riktiga feed-dumpen. De två sista beskrivningarna är
 * lika viktiga som de första: vakterna får inte fälla de sealed-SKU:er som bär samma
 * ord ("Premium Figure Collection", "Accessory Pouch Special Collection").
 */
import { describe, it, expect } from "vitest";
import {
  isAccessoryListing,
  isMerchandiseListing,
  isSingleCardListing,
} from "@/scrapers/matching";
import { isBlockedListingLanguage } from "@/lib/listing-language";

const URL = "https://exempel.se/products/x";

describe("isSingleCardListing — brädgårdsprefixet", () => {
  it("fäller samlarnummer som föregås av #", () => {
    // Pokétalk skriver ALLA sina singlar så. `#` saknades i avgränsarklassen, så
    // hela sortimentet passerade som sealed.
    expect(isSingleCardListing("Mewtwo GX - #SV59/SV94 - Pokémon Sun & Moon - Hidden Fates")).toBe(true);
    expect(isSingleCardListing("Pikachu - #TG5/TG30 - Pokémon Sword & Shield - Lost Origin")).toBe(true);
  });

  it("fäller promo-/samlarkod med brädgård utan /total", () => {
    expect(isSingleCardListing("Charizard VSTAR - #SWSH262 - Pokémon Sword & Shield - Promo")).toBe(true);
    expect(isSingleCardListing("Haunter - #MEP027 - Pokémon Mega Evolution - Promo")).toBe(true);
    expect(isSingleCardListing("Shining Lugia - #SM82 - Sun & Moon - Promo")).toBe(true);
  });

  it("⛔ träffar INTE HTML-entiteten &#039; (apostrof) i butikstitlar", () => {
    // Den gamla siffervarianten hade precis det felet; bokstavsvarianten får inte
    // återinföra det. "Cynthia&#039;s Garchomp Premium Collection" är sealed.
    expect(isSingleCardListing("Cynthia&#039;s Garchomp Premium Collection")).toBe(false);
    expect(isSingleCardListing("Iono&#039;s Bellibolt ex Premium Collection")).toBe(false);
  });

  it("fäller japansk promo-notation men INTE ett sealed promo-PAKET", () => {
    expect(isSingleCardListing("Pikachu Promo 197/SV-P")).toBe(true);
    // ⛔ Pokemurres oöppnade McDonald's-paket namnger kortet i sig och har en levande
    //    butikslänk — ordet "pack" vänder domen.
    expect(
      isSingleCardListing("2025 McDonalds Pokemon Promo Pack Japan Exclusive Sealed Pikachu 020/M-P")
    ).toBe(false);
  });

  it("fäller bulk-lotter och graderade lotter", () => {
    expect(isSingleCardListing("Pokémon AR Bulk (Japanska)")).toBe(true);
    expect(isSingleCardListing("Pokémon RR/RRR (EX/V/VSTAR/VMAX) Bulk (Japanska)")).toBe(true);
    expect(
      isSingleCardListing("Phoenix Shield Suitcase Graded Card Collect Box Red & White (42 graded cards)")
    ).toBe(true);
  });

  it("⛔ fäller INGET i katalogens sealed-vokabulär", () => {
    for (const t of [
      "Prismatic Evolutions Elite Trainer Box",
      "Journey Together Booster Bundle",
      "Mega Lucario ex Figure Collection",
      "Poké Ball Tin 2026",
      "Trick or Trade BOOster Bundle 2024",
      "Scarlet & Violet 151 Ultra-Premium Collection",
    ]) {
      expect(isSingleCardListing(t), t).toBe(false);
    }
  });
});

describe("isMerchandiseListing — leksakssortimentet", () => {
  it("fäller merch som bär ordet 'display' (kortställ, inte boosterdisplay)", () => {
    // Bart "display" vetade merch-vakten och skyddade exakt fel varor.
    expect(isMerchandiseListing("Pokémon Plush Toy Card Display Gift Box")).toBe(true);
    expect(isMerchandiseListing("Pokémon Terastal Grand Gathering Eeveelution Card Display Keychain Gift Box")).toBe(true);
  });

  it("fäller figurer i engelsk pluralform", () => {
    // `figur(er|in|ine)?s?` missade "figure"/"figures".
    expect(isMerchandiseListing("Pokémon Prime Figures")).toBe(true);
    expect(isMerchandiseListing("Pokemon Holly Box Villain Costume (Team Rocket) Pikachu Figure Box")).toBe(true);
  });

  it("fäller myntset, blindboxar, godis, spelarguider och markörer", () => {
    expect(isMerchandiseListing("Pokémon Terastal Grand Gathering Eevee & Friends Coin Set - Eevee")).toBe(true);
    expect(isMerchandiseListing("Pokémon Palmsize Wonders Series 2 Eeveelution Blind Box")).toBe(true);
    expect(isMerchandiseListing("Lotte Pokemon Gummy Candies 80g (Japanskt)")).toBe(true);
    expect(isMerchandiseListing("Stellar Crown Player's Guide")).toBe(true);
    expect(isMerchandiseListing("Pokemon Burn och Poison markör")).toBe(true);
  });

  it("⛔ 'Figure Collection' ÄR en sealed-produktlinje och får aldrig fällas", () => {
    // MÄTT: åtta katalogprodukter och 24 levande butikslänkar. Sealed-ordet vetar.
    for (const t of [
      "Prismatic Evolutions Premium Figure Collection",
      "Arceus V Figure Collection",
      "30th Celebration: Mew Figure Collection",
      "Crown Zenith: Shiny Zacian Premium Figure Collection",
    ]) {
      expect(isMerchandiseListing(t), t).toBe(false);
    }
  });

  it("⛔ adventskalendern och poster collection står kvar orörda", () => {
    expect(isMerchandiseListing("Pokémon Adventskalender 2025")).toBe(false);
    expect(isMerchandiseListing("Ascended Heroes Premium Poster Collection")).toBe(false);
  });
});

describe("isAccessoryListing — svenska sammansättningar och kortställ", () => {
  it("fäller 'Samlarpärm' (pärm utan inledande ordgräns)", () => {
    expect(isAccessoryListing("Pokemon ME5 Pitch Black Samlarpärm 4-fickor")).toBe(true);
    expect(isAccessoryListing("Pokemon ME5 Pitch Black Samlarpärm 9-fickor")).toBe(true);
  });

  it("fäller kortställ ('card display'), inte boosterdisplayer", () => {
    expect(isAccessoryListing("Pokémon Card Display Set Gift Box Charizard")).toBe(true);
    expect(isAccessoryListing("Pokémon TCG - Ninja Spinner Booster Japansk Display (30 Boosters)")).toBe(false);
  });

  it("⛔ bart 'accessory' är förbjudet — Accessory Pouch Special Collection är sealed", () => {
    // En katalogprodukt och sju levande butikslänkar. Tillbehörsvakten har inget
    // sealed-ord-veto, så ett så generellt ord hade nollat dem tyst.
    expect(isAccessoryListing("Prismatic Evolutions: Accessory Pouch Special Collection")).toBe(false);
    expect(isAccessoryListing("Pokémon TCG: Prismatic Evolutions Accessory Pouch Collection")).toBe(false);
  });

  it("⛔ 'Album 2-Pack Blister' är fortfarande en riktig SKU", () => {
    expect(isAccessoryListing("Guardians Rising Collector's Album 2-Pack Blister")).toBe(false);
  });
});

describe("isBlockedListingLanguage — hela den kinesiska setkodsfamiljen", () => {
  it("fäller C…C-koder utanför CSV-grenen", () => {
    expect(isBlockedListingLanguage("Captain Pikachu CBB1C 0709/09", URL)).toBe(true);
    expect(isBlockedListingLanguage("Pokemon Gem Pack CBB4C", URL)).toBe(true);
  });

  it("behåller de sedan tidigare kända formerna", () => {
    expect(isBlockedListingLanguage("Pokemon CSV10C Booster Box", URL)).toBe(true);
    expect(isBlockedListingLanguage("Pokémon Booster Box (KOR)", URL)).toBe(true);
    expect(isBlockedListingLanguage("[S-CHN] Pokémon BOOSTERPACK – Brave Stars (CS5a)", URL)).toBe(true);
  });

  it("⛔ fäller inte engelska/japanska titlar", () => {
    for (const t of [
      "Pokémon Scarlet & Violet: Prismatic Evolutions Elite Trainer Box",
      "Pokémon Mega Evolution: Ascended Heroes Booster Bundle (ME2.5)",
      "Pokemon Card Game Scarlet & Violet Booster Box (Japansk)",
      "Pokémon TCG: Mega Lucario ex League Battle Deck",
    ]) {
      expect(isBlockedListingLanguage(t, URL), t).toBe(false);
    }
  });
});
