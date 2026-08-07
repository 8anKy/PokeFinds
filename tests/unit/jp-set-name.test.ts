import { describe, expect, it } from "vitest";
import {
  codeFromJpSetName,
  codesInTitle,
  deriveJpSetName,
  jpSeriesFromTcgdexId,
  jpSetDisplayName,
  pickJpSetImage,
  releaseDateAgrees,
  stripFormWords,
  JP_CODE_BY_NAME,
  JP_SERIES_UNKNOWN,
} from "@/lib/jp-set-name";

/**
 * Alla rader nedan är RIKTIGA produktnamn ur Cardmarkets publika sealed-katalog
 * (products_nonsingles_6.json, hämtad 2026-08-07) och riktiga butikstitlar ur
 * produktionsdatabasen. Testet vaktar det som avgör om ett japanskt set får rätt
 * namn — och namnet är det enda användaren ser i filtret.
 */
describe("stripFormWords", () => {
  it("skalar av staplade formord", () => {
    expect(stripFormWords("Black Bolt JP Deluxe Booster Box")).toBe("Black Bolt");
    expect(stripFormWords("Shiny Star V Booster Box Case")).toBe("Shiny Star V");
    expect(stripFormWords("Mega Symphonia Booster")).toBe("Mega Symphonia");
  });

  it("rör inte namn som INNEHÅLLER ett formord mitt i", () => {
    // "ex" och siffror är en del av setnamnet — bara efterföljande formord tas.
    expect(stripFormWords("Terastal Festival ex Booster")).toBe("Terastal Festival ex");
    expect(stripFormWords("Pokémon Card 151 Booster Box")).toBe("Pokémon Card 151");
  });
});

describe("deriveJpSetName", () => {
  it("tar prefixet ur booster-/displayraderna", () => {
    expect(
      deriveJpSetName([
        { name: "Black Bolt / White Flare JP Card File Set", categoryName: "Pokémon Box Set" },
        { name: "Black Bolt JP Booster Box", categoryName: "Pokémon Display" },
        { name: "Black Bolt JP Booster Box Case", categoryName: "Pokémon Display" },
        { name: "Black Bolt JP Booster", categoryName: "Pokémon Booster" },
      ])
    ).toBe("Black Bolt");
  });

  it("IGNORERAR mynt och specialaskar med egna namn", () => {
    // Verklig fälla: expansion 5928 (Terastal Festival ex) innehåller "Pokémon Coin
    // Collection Vol.5 Box" och "Korean Terastal Festival ex Binder Set". Räknas de
    // med blir det gemensamma prefixet tomt och setet namnlöst.
    expect(
      deriveJpSetName([
        { name: "Terastal Festival ex Booster", categoryName: "Pokémon Booster" },
        { name: "Terastal Festival ex Booster Box", categoryName: "Pokémon Display" },
        { name: "Terastal Festival ex Booster Box Case", categoryName: "Pokémon Display" },
        { name: "Pokémon Coin Collection Vol.5 Box", categoryName: "Pokémon Coins" },
        { name: "Korean Terastal Festival ex Binder Set", categoryName: "Pokémon Box Set" },
      ])
    ).toBe("Terastal Festival ex");

    // Expansion 6427: specialasken heter "Mega Gallade ex Special Set" — setet
    // heter Nihil Zero.
    expect(
      deriveJpSetName([
        { name: "Mega Gallade ex Special Set", categoryName: "Pokémon Box Set" },
        { name: "Nihil Zero Booster Box Case", categoryName: "Pokémon Display" },
        { name: "Nihil Zero Booster Box", categoryName: "Pokémon Display" },
        { name: "Nihil Zero Booster", categoryName: "Pokémon Booster" },
      ])
    ).toBe("Nihil Zero");
  });

  it("klarar en ensam booster-rad", () => {
    expect(
      deriveJpSetName([{ name: "Abyss Eye Booster", categoryName: "Pokémon Booster" }])
    ).toBe("Abyss Eye");
  });

  it("returnerar null i stället för ett tomt namn", () => {
    expect(deriveJpSetName([])).toBeNull();
    expect(deriveJpSetName([{ name: "Pokémon Coin Vol.5", categoryName: "Pokémon Coins" }])).toBeNull();
    // Bara formord kvar efter avskalningen → inget namn, alltså inget set.
    expect(deriveJpSetName([{ name: "Booster Box", categoryName: "Pokémon Display" }])).toBeNull();
  });
});

describe("codesInTitle", () => {
  it("hittar butikernas setkoder oavsett skrivning", () => {
    expect(codesInTitle("Pokémon, Scarlet & Violet: Mask of Change - sv6, Display / Booster Box (Japansk)")).toContain("sv6");
    expect(codesInTitle("Pokemon Jet Black Spirit / Poltergeist Booster (s6K)(Japansk)")).toContain("s6k");
    expect(codesInTitle("Pokémon Scarlet & Violet: Black Bolt SV11B Booster Box (Japanese)")).toContain("sv11b");
    expect(codesInTitle("Mega Dream ex Booster Pack (Japansk) - M2a")).toContain("m2a");
  });

  it("hittar ingen kod i titlar som saknar den", () => {
    expect(codesInTitle("Pokemon VMAX Climax Booster (Japansk)")).toHaveLength(0);
    expect(codesInTitle("Pokémon Abyss Eye Booster Box (Japansk)")).toHaveLength(0);
  });
});

describe("releaseDateAgrees", () => {
  // Fönstret är kalibrerat på de 39 expansioner vars kod står i butikstitlarna.
  it("godtar de mätta avstånden", () => {
    // Silver Lance: CM la in produkterna 21 dygn före släppet.
    expect(releaseDateAgrees(new Date("2021-04-02"), new Date("2021-04-23"))).toBe(true);
    // Battle Region: 3 dygn.
    expect(releaseDateAgrees(new Date("2022-02-22"), new Date("2022-02-25"))).toBe(true);
  });

  it("avvisar det som ligger utanför", () => {
    // 25th Anniversary: 118 dygn — utanför fönstret, alltså inget datum på setet.
    expect(releaseDateAgrees(new Date("2021-06-26"), new Date("2021-10-22"))).toBe(false);
  });
});

describe("jpSetDisplayName", () => {
  it("skriver ut koden när den är känd", () => {
    // Koden är inte dekoration: "Black Bolt" finns som BÅDE japanskt och engelskt
    // set, och utan koden står samma namn två gånger i filtret.
    expect(jpSetDisplayName("Black Bolt", "SV11B")).toBe("Black Bolt (SV11B)");
    expect(jpSetDisplayName("25th Anniversary", null)).toBe("25th Anniversary");
  });
});

describe("codeFromJpSetName", () => {
  it("läser tillbaka koden ur vår egen skrivning", () => {
    expect(codeFromJpSetName("Black Bolt (SV11B)")).toBe("SV11B");
    expect(codeFromJpSetName("VSTAR Universe (S12a)")).toBe("S12a");
    expect(codeFromJpSetName("Mega Brave (M1L)")).toBe("M1L");
  });

  it("hittar ingen kod där vi inte skrivit någon", () => {
    expect(codeFromJpSetName("25th Anniversary")).toBeNull();
    // En parentes som INTE är en setkod får inte tolkas som en.
    expect(codeFromJpSetName("Shiny Treasure ex (special)")).toBeNull();
  });
});

describe("jpSeriesFromTcgdexId", () => {
  it("översätter serie-id till den latinska eran", () => {
    // Samma skrivning som de engelska seten använder — rubrikerna i set-arket ska
    // läsa likadant i båda flikarna.
    expect(jpSeriesFromTcgdexId("SV")).toBe("Scarlet & Violet");
    expect(jpSeriesFromTcgdexId("S")).toBe("Sword & Shield");
    expect(jpSeriesFromTcgdexId("SM")).toBe("Sun & Moon");
    expect(jpSeriesFromTcgdexId("M")).toBe("Mega Evolution");
  });

  it("hittar ALDRIG på en era", () => {
    expect(jpSeriesFromTcgdexId(null)).toBe(JP_SERIES_UNKNOWN);
    expect(jpSeriesFromTcgdexId(undefined)).toBe(JP_SERIES_UNKNOWN);
    expect(jpSeriesFromTcgdexId("ZZ")).toBe(JP_SERIES_UNKNOWN);
  });
});

describe("pickJpSetImage", () => {
  it("väljer boosterPÅSEN före lådan", () => {
    // Den japanska påsens omslag BÄR setets logotyp — lådan visar en låda.
    expect(
      pickJpSetImage([
        { category: "BOOSTER_BOX", imageUrl: "/api/cm-image/883955" },
        { category: "BOOSTER_PACK", imageUrl: "/api/cm-image/883956" },
      ])
    ).toBe("/api/cm-image/883956");
  });

  it("väljer Cardmarket-rendern före butiksfotot", () => {
    expect(
      pickJpSetImage([
        { category: "BOOSTER_PACK", imageUrl: "https://cdn.shopify.com/s/files/butiksfoto.jpg" },
        { category: "BOOSTER_BOX", imageUrl: "https://www.foilio.se/api/cm-image/831328" },
      ])
    ).toBe("https://www.foilio.se/api/cm-image/831328");
  });

  it("tar vad som finns hellre än ingenting", () => {
    expect(
      pickJpSetImage([
        { category: "COLLECTION_BOX", imageUrl: null },
        { category: "COLLECTION_BOX", imageUrl: "https://cdn.shopify.com/s/files/x.jpg" },
      ])
    ).toBe("https://cdn.shopify.com/s/files/x.jpg");
  });

  it("returnerar null när inget set-medlem har en bild", () => {
    expect(pickJpSetImage([])).toBeNull();
    expect(pickJpSetImage([{ category: "BOOSTER_PACK", imageUrl: null }])).toBeNull();
  });
});

describe("JP_CODE_BY_NAME", () => {
  it("nycklas på gemener — uppslaget sker på det härledda namnet", () => {
    for (const key of Object.keys(JP_CODE_BY_NAME)) expect(key).toBe(key.toLowerCase());
  });
});
