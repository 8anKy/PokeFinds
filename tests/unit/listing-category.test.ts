/**
 * Vakt för den DELADE annonsklassificeraren (src/scrapers/listing-category.ts).
 *
 * Varför tester och inte bara ögonmått: kategorin avgör om varan existerar för oss.
 * `OTHER` ligger i HIDDEN_CATEGORIES → produkten är osynlig i katalogen, tyst i
 * restock-larmen och kan aldrig skapas av feed-först-grenen (SEALED_FEED_CATEGORIES).
 * MÄTT 2026-08-15 mot 42 butikers levande feedar: 436 riktiga Pokémon-sealed-annonser
 * blockerades enbart av att den gamla ordlistan inte kände igen formen.
 */
import { describe, it, expect } from "vitest";
import { guessListingCategory } from "@/scrapers/listing-category";

describe("guessListingCategory — de sju ursprungliga formerna", () => {
  it("känner igen boosterboxar och displayer", () => {
    expect(guessListingCategory("Prismatic Evolutions Booster Box")).toBe("BOOSTER_BOX");
    expect(guessListingCategory("Sun & Moon Display / Booster Box")).toBe("BOOSTER_BOX");
  });

  it("läser 'Booster … Display' som box även när orden inte står intill varandra", () => {
    // Dragon's Lair skriver "Booster Japansk Display (30 Boosters)" — `booster\s*display`
    // matchar inte, så de fem japanska displayerna klassades som BOOSTER_PACK.
    expect(guessListingCategory("Pokémon TCG - Ninja Spinner Booster Japansk Display (30 Boosters)")).toBe("BOOSTER_BOX");
    expect(guessListingCategory("Pokémon: Mega Evolution - Pitch Black Display (36 booster packs)")).toBe("BOOSTER_BOX");
    expect(guessListingCategory("Pokémon TCG: Surging Sparks Booster Small Display")).toBe("BOOSTER_BOX");
  });

  it("känner igen ETB, bundle, pack, collection box, tin och blister", () => {
    expect(guessListingCategory("Journey Together Elite Trainer Box")).toBe("ETB");
    expect(guessListingCategory("Ascended Heroes Booster Bundle")).toBe("BUNDLE");
    expect(guessListingCategory("Ascended Heroes Booster Pack")).toBe("BOOSTER_PACK");
    expect(guessListingCategory("Paldean Fates Premium Collection")).toBe("COLLECTION_BOX");
    expect(guessListingCategory("Lance's Charizard V Tin")).toBe("TIN");
    expect(guessListingCategory("Journey Together: Scrafty 3-Pack Blister")).toBe("BLISTER");
  });

  it("kräver ordgräns FÖRE 'tin' — tyska 'Karmesin' är inte en plåtask", () => {
    // Tre av de tio adapterkopiorna testade `/tin\b/` utan inledande gräns.
    expect(guessListingCategory("Pokémon Karmesin & Purpur Top-Trainer-Box")).not.toBe("TIN");
    expect(guessListingCategory("Martin's Pokémon Sammlung")).not.toBe("TIN");
  });

  it("kräver ordgränser runt 'etb'", () => {
    expect(guessListingCategory("Pokémon Sableye ex Box")).not.toBe("ETB");
  });
});

describe("guessListingCategory — formerna som föll till OTHER (2026-08-15)", () => {
  const collectionBox = [
    "Pokemon TCG: 2025 World Championship Deck - JP Raging Bolt",
    "Pokemon TCG: Calyrex Vmax League Battle Deck Q2 '22 - Shadow Rider",
    "Pokémon TCG: Deluxe Battle Deck - Zapdos ex",
    "Pokémon Rival Battle Deck Steven",
    "Pokémon, Sword & Shield, Theme Deck: Cinderace",
    "Pokémon MEGA Starter Set Sprigatito & Meowscarada ex",
    "Pokémon Scarlet & Violet: Zacian ex & Alcremie ex Starter Deck",
    "Pokémon 30th Celebration Premium Deck Set: Espeon & Umbreon",
    "Pokémon XY Evolutions: Build & Battle Box",
    "Pokémon Scarlet & Violet: Paldea Evolved Build & Battle Stadium",
    "Pokémon Scarlet & Violet: Stellar Crown Build & Battle Kit (4 pack)",
    "Pokémon TCG: Trainer's Toolkit 2024",
    "Pokemon Battle Academy Pikachu vs Eevee vs Cinderace",
    "Pokémon 30th Celebration Futuristic Box",
    "Prismatic Evolutions Premium Figure Collection",
    "Pokémon Ascended Heroes - Premium Poster Collection",
    "Pokémon GO Pin Collection",
    "Pokémon GO Special Collection Team Valor",
  ];
  for (const title of collectionBox) {
    it(`"${title}" → COLLECTION_BOX`, () => {
      expect(guessListingCategory(title)).toBe("COLLECTION_BOX");
    });
  }

  it("stavningsvarianterna butikerna faktiskt använder", () => {
    // ⛔ "Championship" OCH "Championships": Alphaspel skriver singular, Speltrollet
    //    plural. Ett saknat "s" lämnade fyra 2024-deck i OTHER.
    expect(guessListingCategory("Pokémon TCG: 2024 World Championships Deck - Iron Thorns ex")).toBe("COLLECTION_BOX");
    // Den japanska linjen heter "Start Deck", inte "Starter Deck".
    expect(guessListingCategory("Pokemon MEGA Start Deck 100 Battle Collection (Japansk)")).toBe("COLLECTION_BOX");
    // Pokémon Centers egen sealed-linje.
    expect(guessListingCategory("Pokémon Center: Shiny Star V Crobat Special Box")).toBe("COLLECTION_BOX");
    expect(guessListingCategory("Pokémon TCG: Special Box Pokemon Center Tohoku (Japansk)")).toBe("COLLECTION_BOX");
  });

  it("promo-paket blir BOOSTER_PACK", () => {
    expect(guessListingCategory("Pokémon GO Promo Pack (Japansk)")).toBe("BOOSTER_PACK");
    expect(guessListingCategory('Pokemon TCG: First Partner 25th Anniversary Oversized Card Promo Pack "Kalos"')).toBe("BOOSTER_PACK");
  });
});

describe("guessListingCategory — ordningen är betydelsebärande", () => {
  it("en 'Tech Sticker Collection Blister' är en BLISTER, inte en collection box", () => {
    // ⛔ Regressionsvakt: när den kvalificerade collection-regeln låg FÖRE blister
    //    bytte sex av Aquitaz blistrar kategori. Kvalificeringen beskriver innehållet,
    //    inte formen.
    expect(
      guessListingCategory("Pokémon Mega Evolution: Ascended Heroes Tech Sticker Collection Blister (Gastly) (3 Pack)")
    ).toBe("BLISTER");
    expect(guessListingCategory("Pokemon SV8.5: Prismatic Evolutions Tech Sticker Collection")).toBe("COLLECTION_BOX");
  });

  it("'Booster Bundle' vinner över bart 'Bundle', och ETB över 'Box'", () => {
    expect(guessListingCategory("Surging Sparks Booster Bundle")).toBe("BUNDLE");
    expect(guessListingCategory("Surging Sparks Elite Trainer Box")).toBe("ETB");
  });

  it("'deck' ensamt räcker aldrig — deck box och sleeves är tillbehör", () => {
    expect(guessListingCategory("Ultra Pro Deck Box Charizard")).toBe("OTHER");
    expect(guessListingCategory("Pokémon Deck Protector Sleeves")).toBe("OTHER");
  });

  it("okända former stannar i OTHER (grinden håller dem ute som förut)", () => {
    expect(guessListingCategory("Pokémon Prime Figures")).toBe("OTHER");
    expect(guessListingCategory("Pokémon Palmsize Wonders Series 2 Eeveelution Blind Box")).toBe("OTHER");
  });
});

/**
 * FORMER SOM FÖLL TILL OTHER OCH DÄRMED BLEV OSYNLIGA (2026-08-16).
 * Mätt mot alla 42 butikers levande feedar: fyra riktiga sealed-annonser nådde
 * aldrig Discord-kanalen enbart för att klassificeraren inte kände formen.
 * ⛔ OTHER är inte en etikett — den gör varan osynlig i katalogen, tyst i larmen och
 *    oimporterbar. Se filhuvudet i listing-category.ts.
 */
describe("former som tidigare föll till OTHER", () => {
  it("checklane ÄR en blister även utan ordet 'blister'", () => {
    // Resten av kodbasen vet det redan (CHARACTER_IDENTITY_FORMS i matching.ts);
    // klassificeraren gjorde det inte.
    expect(guessListingCategory("Pokemon Scarlet & Violet 9: Journey Together Premium Checklane")).toBe("BLISTER");
    expect(guessListingCategory("Pokemon Pitch Black Checklane (max 2 per hushåll)")).toBe("BLISTER");
    // …och den vanliga skrivningen är oförändrad.
    expect(guessListingCategory("Destined Rivals: Zarude 1-Pack Blister")).toBe("BLISTER");
  });

  it("Illustration Collection är en sealed-linje", () => {
    expect(guessListingCategory("Pokémon TCG: First Partner Illustration Collection Series 2")).toBe("COLLECTION_BOX");
  });

  it("⛔ men bart 'illustration' är kortRARITETEN, inte en form", () => {
    // "Illustration Rare" är en rarity på ENSKILDA kort — fångas den blir varje
    // sådan singel en katalogprodukt.
    expect(guessListingCategory("Charizard ex 234/197 Special Illustration Rare")).toBe("OTHER");
  });

  it("Collector's Chest är en plåtask med boosters", () => {
    expect(guessListingCategory("Pokémon, Collectors Chest 2025")).toBe("TIN");
    expect(guessListingCategory("Pokemon Collector's Chest Tin 2024")).toBe("TIN");
  });
});
