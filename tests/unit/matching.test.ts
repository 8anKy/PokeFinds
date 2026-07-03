/**
 * Tester för fuzzy-matchning i src/scrapers/matching.ts.
 * Prisma mockas bort — vi testar bara de rena funktionerna
 * scoreSimilarity och extractSetNumber.
 */
import { describe, expect, it, vi } from "vitest";

const { offerFindFirst, productFindUnique } = vi.hoisted(() => ({
  offerFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    offer: { findFirst: offerFindFirst },
    product: { findUnique: productFindUnique },
  },
}));

import {
  cardNumberKey,
  classifyForm,
  extractSetNumber,
  isPlausibleListingPrice,
  matchListingToProduct,
  nonEraCoverage,
  printedNumberKey,
  scoreSimilarity,
} from "@/scrapers/matching";

describe("scoreSimilarity", () => {
  it("identiska titlar ger 1", () => {
    expect(scoreSimilarity("Charizard ex 199/165", "Charizard ex 199/165")).toBe(1);
  });

  it("identiska efter normalisering ger 1 (skiftläge/specialtecken ignoreras)", () => {
    expect(scoreSimilarity("Pokémon TCG: Booster Box", "pokemon tcg booster box")).toBe(1);
  });

  it("helt olika strängar ger ungefär 0", () => {
    expect(scoreSimilarity("xyzqw", "abcde")).toBeLessThan(0.1);
  });

  it("liknande titlar ger hög poäng", () => {
    const score = scoreSimilarity(
      "Surging Sparks Elite Trainer Box",
      "Pokemon Surging Sparks Elite Trainer Box EN"
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it("delvis överlappande titlar ger mellanpoäng", () => {
    const score = scoreSimilarity("Surging Sparks Booster Box", "Surging Sparks Booster Pack");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("tom sträng ger 0", () => {
    expect(scoreSimilarity("", "Pikachu")).toBe(0);
    expect(scoreSimilarity("Pikachu", "")).toBe(0);
    expect(scoreSimilarity("!!!", "Pikachu")).toBe(0); // normaliseras till tomt
  });

  it("är symmetrisk", () => {
    const a = "Charizard ex Super Premium Collection";
    const b = "Charizard Premium Collection Box";
    expect(scoreSimilarity(a, b)).toBeCloseTo(scoreSimilarity(b, a), 10);
  });
});

describe("extractSetNumber", () => {
  it("extraherar setnummer som num/total", () => {
    expect(extractSetNumber("Pikachu 25/102 Holo")).toEqual({ num: 25, total: 102 });
  });

  it("hanterar mellanslag runt snedstrecket", () => {
    expect(extractSetNumber("Mew 151 / 165")).toEqual({ num: 151, total: 165 });
  });

  it("returnerar null när setnummer saknas", () => {
    expect(extractSetNumber("Booster Box Surging Sparks")).toBeNull();
  });

  it("matchar inte fler än tre siffror", () => {
    expect(extractSetNumber("artikel 1234/5678")).toBeNull();
  });

  it("hanterar nummer med inledande nollor", () => {
    expect(extractSetNumber("Eevee 025/102")).toEqual({ num: 25, total: 102 });
  });

  it("parsar promo-format med bokstavsprefix (RC5/RC32, TG12/TG30)", () => {
    expect(extractSetNumber("Charizard RC5/RC32")).toEqual({ num: 5, total: 32 });
    expect(extractSetNumber("Giratina TG12/TG30")).toEqual({ num: 12, total: 30 });
    // Promo-numret skiljer sig från ett 151-kort → de får inte se likadana ut.
    expect(extractSetNumber("Charizard ex 151 6/165")).toEqual({ num: 6, total: 165 });
  });
});

describe("cardNumberKey / printedNumberKey", () => {
  it("normaliserar kortnummer (prefix + heltal utan nollor, total ignoreras)", () => {
    expect(cardNumberKey("RC5")).toBe("rc5");
    expect(cardNumberKey("GG01")).toBe("gg1");
    expect(cardNumberKey("006")).toBe("6");
    expect(cardNumberKey("6")).toBe("6");
    expect(cardNumberKey(null)).toBeNull();
  });

  it("plockar tryckt nummer ur titel (vänstersidan av X/Y) med samma nyckel", () => {
    expect(printedNumberKey("charizard rc5/rc32")).toBe("rc5");
    expect(printedNumberKey("charizard ex 151 6/165")).toBe("6");
    expect(printedNumberKey("hisuian voltorb crown zenith gg01/70")).toBe("gg1");
    expect(printedNumberKey("ingen siffra här")).toBeNull();
  });

  it("samma kort matchar, fel kort (151 #6 vs promo RC5) skiljer sig", () => {
    // Kärnan i buggen: en RC5-annons får INTE dela nyckel med 151-kortets #6.
    expect(printedNumberKey("charizard rc5/rc32")).not.toBe(
      printedNumberKey("charizard ex 151 6/165")
    );
    // Men RC5-annonsens nyckel == katalogens RC5-kortnummer.
    expect(printedNumberKey("charizard rc5/rc32")).toBe(cardNumberKey("RC5"));
  });
});

describe("classifyForm", () => {
  it("svensk samlarpärm/album klassas som tillbehör (matchar ej collection/box)", () => {
    expect(classifyForm("Ultra-Pro Samlarpärm 4-pocket binder Pokemon Greninja")).toBe("accessory");
    expect(classifyForm("Ultra-Pro Greninja 2-inch album for Pokemon")).toBe("accessory");
  });

  it("svensk spelbordsmatta/spelmatta (playmat) klassas som tillbehör", () => {
    // Webhallen: "Ultra Pro Pokemon Mega Charizard X&Y Spelbordsmatta" fastnade fel
    // som offer på "Mega Charizard X ex Ultra Premium Collection".
    expect(classifyForm("Ultra Pro Pokemon Mega Charizard X&Y Spelbordsmatta 6 FT")).toBe("accessory");
  });

  it("en enskild Mini Tin är 'tin', men ett Mini Tin Display är 'display'", () => {
    expect(classifyForm("Ascended Heroes Mini Tin")).toBe("tin");
    expect(classifyForm("Ascended Heroes: Mini Tin Display")).toBe("display");
  });

  it("'Battle Academy' klassas som deck → karaktärsvakt skiljer den från annan deck", () => {
    expect(classifyForm("Pokemon TCG Battle Academy 2024")).toBe("deck");
    // Får INTE matcha en helt annan deck bara för det delade ordet "battle".
    expect(
      matchListingToProduct("Pokemon TCG Battle Academy 2024", {
        normalizedTitle: "pokemon go battle deck melmetal v",
        card: null,
      })
    ).toBeNull();
  });
});

describe("nonEraCoverage — set-markör 'go' (Pokémon GO 10.5)", () => {
  const GO = "Pokemon Sword & Shield 10.5: Pokémon GO Booster Pack";
  const BASE = "Sword & Shield Booster Pack";

  it("GO-packen täcker INTE bas-'Sword & Shield Booster Pack' (under tröskel → förkastas)", () => {
    // 'go' är enda särskiljande markören; bas-produkten saknar den → ingen täckning.
    expect(nonEraCoverage(GO, BASE)).toBeLessThan(0.5);
  });

  it("äkta bas-pack matchar fortfarande sig själv (ren era-titel → full täckning)", () => {
    expect(nonEraCoverage(BASE, BASE)).toBe(1);
  });
});

describe("matchListingToProduct — riktad match (Tradera Fas 0)", () => {
  const swshPack = { normalizedTitle: "sword shield booster pack", card: null };
  const umbreon = {
    normalizedTitle: "umbreon vmax evolving skies 95 203",
    card: { name: "Umbreon VMAX", number: "95" },
  };

  it("ren bas-pack-annons matchar bas-produkten", () => {
    expect(matchListingToProduct("Sword & Shield Booster Pack förseglad", swshPack)).not.toBeNull();
  });

  it("GO 10.5-pack matchar INTE bas-'Sword & Shield Booster Pack'", () => {
    expect(
      matchListingToProduct("Pokemon Sword & Shield 10.5: Pokémon GO Booster Pack", swshPack)
    ).toBeNull();
  });

  it("singel matchar på rätt tryckt nummer + namn", () => {
    expect(matchListingToProduct("Umbreon VMAX 95/203 Evolving Skies", umbreon)).toBe(0.9);
  });

  it("fel nummer (Moonbreon 215/203) matchar INTE 95/203-kortet", () => {
    expect(matchListingToProduct("Umbreon VMAX Alt Art 215/203", umbreon)).toBeNull();
  });

  it("japansk 'Violet ex'-pack matchar INTE engelska 'Scarlet & Violet Booster Pack'", () => {
    const svPack = { normalizedTitle: "scarlet violet booster pack", card: null };
    // Japansk sv1V-annons, "japansk" står bara i beskrivningen (ej titeln).
    expect(
      matchListingToProduct("Scarlet & Violet: Violet ex Booster Pack - Pokemon Trading Card Game", svPack)
    ).toBeNull();
    // Äkta engelsk bas-pack matchar fortfarande.
    expect(matchListingToProduct("Pokemon Scarlet & Violet Booster Pack", svPack)).not.toBeNull();
  });

  it("äkta engelsk bas-pack med set-kod (SV01) + hopskrivet formord matchar bas-produkten", () => {
    const svPack = { normalizedTitle: "scarlet violet booster pack", card: null };
    // Verklig Tradera-titel med set-kod SV01 resp. hopskrivet "Boosterpack".
    expect(matchListingToProduct("Pokémon SV01: Scarlet & Violet Booster Pack", svPack)).not.toBeNull();
    expect(matchListingToProduct("Scarlet & Violet Booster Pack SV01", svPack)).not.toBeNull();
    // Japanskt DELSET (eget namn kvar) matchar fortfarande INTE.
    expect(matchListingToProduct("Scarlet & Violet: Cyber Judge Booster Pack", svPack)).toBeNull();
    expect(matchListingToProduct("Pokemon booster pack Obsidian Flames", svPack)).toBeNull();
  });

  it("'base' är ett äkta vintage-setnamn — inte brus (vintage-basen matchar sig själv)", () => {
    const svPack = { normalizedTitle: "scarlet violet booster pack", card: null };
    const vintageBase = { normalizedTitle: "base booster pack", card: null };
    // Vintage bas-pack matchar sin egen produkt, inte S&V (om "base" vore brus skulle
    // vintage-basen tappa sitt enda särskiljande ord och sluta matcha).
    expect(matchListingToProduct("Pokemon Base Set Booster Pack", vintageBase)).not.toBeNull();
    expect(matchListingToProduct("Pokemon Base Set Booster Pack", svPack)).toBeNull();
  });
});

describe("isPlausibleListingPrice", () => {
  const CM = 233_300; // 2 333 kr i öre (Mega Charizard X UPC)
  const setCm = (price: number | null, category: string) => {
    offerFindFirst.mockResolvedValue(price == null ? null : { price });
    productFindUnique.mockResolvedValue({ category });
  };

  it("dyr kategori (COLLECTION_BOX): grovt under-pris (149 kr på 2 333 kr = 6 %) förkastas", async () => {
    setCm(CM, "COLLECTION_BOX");
    expect(await isPlausibleListingPrice("p1", 14_900)).toBe(false);
  });

  it("dyr kategori: rimligt pris nära CM godkänns", async () => {
    setCm(CM, "COLLECTION_BOX");
    expect(await isPlausibleListingPrice("p1", 210_000)).toBe(true);
  });

  it("billig kategori (BOOSTER_PACK): under-vakten gäller INTE — ärligt billig pack behålls", async () => {
    // 69 kr pack där CM-ref felaktigt är 860 kr (sealed-id-bugg) = 8 %. Ingen
    // under-vakt på pack → behålls (annars raderar vi rätt pris, behåller fel CM).
    setCm(86_000, "BOOSTER_PACK");
    expect(await isPlausibleListingPrice("p1", 6_900)).toBe(true);
  });

  it("billig kategori (TIN): under-vakten gäller inte", async () => {
    setCm(29_000, "TIN");
    expect(await isPlausibleListingPrice("p1", 1_900)).toBe(true);
  });

  it("dyr kategori (BUNDLE): över-pris (>2,5×) förkastas oavsett", async () => {
    setCm(25_000, "BUNDLE");
    expect(await isPlausibleListingPrice("p1", 229_500)).toBe(false);
  });

  it("billig kategori (BOOSTER_PACK): butiks-markup 2,5×+ över CM är lagligt → behålls", async () => {
    // 50 kr CM-pack som butiken säljer för 129 kr (2,58×) = normal svensk markup.
    setCm(5_000, "BOOSTER_PACK");
    expect(await isPlausibleListingPrice("p1", 12_900)).toBe(true);
  });

  it("sealed: lott-pris långt över CM (3×) förkastas", async () => {
    setCm(CM, "BOOSTER_BOX");
    expect(await isPlausibleListingPrice("p1", CM * 3)).toBe(false);
  });

  it("singel: billigt pris har ingen under-vakt → godkänns", async () => {
    setCm(20_000, "SINGLE_CARD");
    expect(await isPlausibleListingPrice("p1", 1_000)).toBe(true);
  });

  it("saknas CM-referens → godkänns (kan inte bedöma)", async () => {
    setCm(null, "COLLECTION_BOX");
    expect(await isPlausibleListingPrice("p1", 100)).toBe(true);
  });
});
