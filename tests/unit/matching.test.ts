/**
 * Tester för fuzzy-matchning i src/scrapers/matching.ts.
 * Prisma mockas bort — vi testar bara de rena funktionerna
 * scoreSimilarity och extractSetNumber.
 */
import { describe, expect, it, vi } from "vitest";

const { offerFindFirst, productFindUnique, snapshotFindMany } = vi.hoisted(() => ({
  offerFindFirst: vi.fn(),
  productFindUnique: vi.fn(),
  snapshotFindMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    offer: { findFirst: offerFindFirst },
    product: { findUnique: productFindUnique },
    priceSnapshot: { findMany: snapshotFindMany },
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
  seriesMismatch,
} from "@/scrapers/matching";

describe("seriesMismatch (Series 1 vs Series 2)", () => {
  it("olika serienummer = mismatch", () => {
    expect(seriesMismatch("First Partner Illustration Collection Series 1", "first partner illustration collection series 2")).toBe(true);
    expect(seriesMismatch("First Partner Series 1 Boosterpakke", "first partner illustration booster series 2")).toBe(true);
  });
  it("samma serienummer / saknat nummer = ingen mismatch", () => {
    expect(seriesMismatch("First Partner Collection Series 2", "first partner illustration collection series 2")).toBe(false);
    expect(seriesMismatch("Surging Sparks Booster Box", "surging sparks booster box")).toBe(false);
  });
  it("matchListingToProduct förkastar fel serie men behåller rätt", () => {
    const s1 = { normalizedTitle: "first partner illustration collection series 1", card: null };
    expect(matchListingToProduct("Pokémon First Partner Illustration Collection Series 2", s1)).toBeNull();
    const s2 = { normalizedTitle: "first partner illustration collection series 2", card: null };
    expect(matchListingToProduct("Pokémon First Partner Illustration Collection Series 2", s2)).not.toBeNull();
  });
});

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

  it("singel utan tryckt nummer kräver kortnamnet (fel kort ur samma set förkastas)", () => {
    const xatu = { normalizedTitle: "xatu paldean fates 152", card: { name: "Xatu", number: "152" } };
    // Annons utan slash-nummer, delar bara set-orden "paldean fates" → förkastas.
    expect(matchListingToProduct("Forretress ex Paldean Fates", xatu)).toBeNull();
    // Rätt kort (namnet finns) matchar fortfarande utan slash-nummer.
    const forretress = { normalizedTitle: "forretress ex paldean fates 130", card: { name: "Forretress ex", number: "130" } };
    expect(matchListingToProduct("Forretress ex Paldean Fates", forretress)).not.toBeNull();
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

  it("151-pack (S&V 3.5) matchar INTE bas-'Scarlet & Violet Booster Pack' och tvärtom", () => {
    const svPack = { normalizedTitle: "scarlet violet booster pack", card: null };
    const p151 = { normalizedTitle: "151 booster pack", card: null };
    // Verklig Samlarhobby-titel: "151" delar era-ord (scarlet/violet) med bas-S&V.
    const listing = "Pokemon Scarlet & Violet 3.5 Pokemon 151 1 booster pack";
    expect(matchListingToProduct(listing, svPack)).toBeNull();
    expect(matchListingToProduct(listing, p151)).not.toBeNull();
    // Ren bas-annons matchar INTE 151-produkten.
    expect(matchListingToProduct("Pokemon Scarlet & Violet Booster Pack", p151)).toBeNull();
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

  it("'base' = identitet utan era, kvalificerare med era (vintage vs S&V-kollision)", () => {
    const svPack = { normalizedTitle: "scarlet violet booster pack", card: null };
    const vintageBase = { normalizedTitle: "base booster pack", card: null };
    // Äkta vintage bas-pack matchar sin egen produkt (base = identitet utan era).
    expect(matchListingToProduct("Pokemon Base Set Booster Pack", vintageBase)).not.toBeNull();
    expect(matchListingToProduct("Pokemon Base Set Booster Pack", svPack)).toBeNull();
    // En S&V "Base Boosterpack"-annons (base = kvalificerare med era) får INTE matcha
    // vintage-basen — det delade ordet "base" gav tidigare 0,64 träff på fel produkt.
    expect(matchListingToProduct("Scarlet & Violet Base Boosterpack", vintageBase)).toBeNull();
  });

  it("brusiga men äkta vintage-titlar matchar (skick/upplaga/förlag = brus, ej identitet)", () => {
    const vintageBase = { normalizedTitle: "base booster pack", card: null };
    const megaETB = { normalizedTitle: "mega evolution elite trainer box", card: null };
    // RECALL: brus (1999/WOTC/Unlimited/Shadowless/oöppnad) får inte sänka täckningen.
    expect(matchListingToProduct("Pokemon Base Set Booster Pack 1999 WOTC", vintageBase)).not.toBeNull();
    expect(matchListingToProduct("Pokémon Base Set Unlimited Booster Pack", vintageBase)).not.toBeNull();
    expect(matchListingToProduct("Base Set Booster Pack oöppnad fabriksförseglad", vintageBase)).not.toBeNull();
    // PRECISION: ett delset-NAMN är inte brus → "Perfect Order" får ändå ej matcha basen.
    expect(matchListingToProduct("Mega Evolution Perfect Order Elite Trainer Box", megaETB)).toBeNull();
  });

  it("set-namn som är superset av kandidatens ('Dragon Majesty' vs vintage-'Dragon') förkastas", () => {
    // Verklig fejkdeal: Tradera "Pokémon Dragon Majesty Booster Pack" (900 kr, SM7.5)
    // matchade vintage "Dragon Booster Pack" (EX Dragon, CM 3 816 kr) → falsk −76 %.
    // Otäckt identitetsord ("majesty") = täckning exakt 0,5 → ska förkastas.
    const vintageDragon = { normalizedTitle: "dragon booster pack", card: null };
    const dragonMajesty = { normalizedTitle: "dragon majesty booster pack", card: null };
    expect(matchListingToProduct("Pokémon Dragon Majesty Booster Pack", vintageDragon)).toBeNull();
    expect(matchListingToProduct("Pokémon Dragon Majesty Booster Pack", dragonMajesty)).not.toBeNull();
  });

  it("annat officiellt produktnamn ('Special Collection' vs 'EX Box') förkastas", () => {
    // Verklig fejkdeal: Tradera "Pokémon TCG: Charizard ex Special Collection" (695 kr)
    // matchade XY-erans "Charizard EX Box" (CM 1 962 kr) → falsk −65 %.
    const exBox = { normalizedTitle: "charizard ex box", card: null };
    const special = { normalizedTitle: "charizard ex special collection", card: null };
    expect(matchListingToProduct("Pokémon TCG: Charizard ex Special Collection", exBox)).toBeNull();
    expect(matchListingToProduct("Pokémon TCG: Charizard ex Special Collection", special)).not.toBeNull();
  });

  it("Pokémon Center-variant ≠ vanlig produkt (åt båda håll)", () => {
    // Verklig fejkdeal: Tradera "Obsidian Flames Elite trainer box" (vanlig, 4 000 kr)
    // matchade "Obsidian Flames Pokémon Center Elite Trainer Box" (CM 7 494 kr) → −47 %.
    const pcEtb = { normalizedTitle: "obsidian flames pokemon center elite trainer box", card: null };
    const etb = { normalizedTitle: "obsidian flames elite trainer box", card: null };
    expect(matchListingToProduct("Obsidian Flames Elite trainer box", pcEtb)).toBeNull();
    expect(matchListingToProduct("Obsidian Flames Pokémon Center Elite Trainer Box", etb)).toBeNull();
    expect(matchListingToProduct("Obsidian Flames Pokémon Center Elite Trainer Box", pcEtb)).not.toBeNull();
    expect(matchListingToProduct("Obsidian Flames Elite trainer box oöppnad", etb)).not.toBeNull();
  });
});

describe("isPlausibleListingPrice", () => {
  const CM = 233_300; // 2 333 kr i öre (Mega Charizard X UPC)
  const setCm = (price: number | null, category: string, historyOre: number[] = []) => {
    offerFindFirst.mockResolvedValue(price == null ? null : { price });
    productFindUnique.mockResolvedValue({ category });
    // Default: ingen stabil historik → undre-vakten på billiga gäller inte (gammalt beteende).
    snapshotFindMany.mockResolvedValue(historyOre.map((avgPrice) => ({ avgPrice })));
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

  // ── Ägarens Tradera-safeguard: pålitligt facit ur stabil historik ──────────
  it("billig kategori (TIN) MED stabil historik: öppnat ex under 15% avvisas", async () => {
    // Riolu-tin: stabil historik ~14 200 öre, Tradera 1 900 öre = 13% → öppnat ex → avvisas.
    setCm(14_200, "TIN", [14_100, 14_200, 14_200, 14_300, 14_200, 14_100]);
    expect(await isPlausibleListingPrice("p1", 1_900)).toBe(false);
  });

  it("billig kategori (TIN) MED stabil historik: ärligt pris över 15% behålls", async () => {
    setCm(14_200, "TIN", [14_100, 14_200, 14_200, 14_300, 14_200, 14_100]);
    expect(await isPlausibleListingPrice("p1", 9_000)).toBe(true);
  });

  it("korrupt CM-ref MEN stabil historik: facitet blir historiken", async () => {
    // CM felmappat lågt (200 öre), historik pålitlig (~14 200). Tradera 1 900 = 13% av
    // historiken → avvisas mot HISTORIKEN, inte det korrupta CM-priset.
    setCm(200, "TIN", [14_100, 14_200, 14_200, 14_300, 14_200, 14_100]);
    expect(await isPlausibleListingPrice("p1", 1_900)).toBe(false);
  });

  it("billig kategori (TIN) UTAN historik: undre-vakten gäller inte (fel CM-ref får ej radera rätt pris)", async () => {
    setCm(86_000, "TIN"); // CM felmappat högt, ingen historik → 69 kr behålls
    expect(await isPlausibleListingPrice("p1", 6_900)).toBe(true);
  });
});
