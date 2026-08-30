import { describe, expect, it } from "vitest";
import {
  blueprintAllowsReverse,
  cheapestNonReverseNmEn,
  cheapestReverseNmEn,
  ctNumberKey,
  judgeReversePrice,
  ctSetNameKey,
  isPublishableReverseListing,
  isSingleBlueprint,
  matchExpansion,
  shouldDistrustDexTaxonomy,
  matchBallExpansions,
  matchJpBallExpansions,
  isBuyableNmListing,
  ctNamesAgree,
  type CtBlueprint,
  type CtExpansion,
  type CtListing,
} from "@/lib/cardtrader";
import { VARIANT_MASTER_BALL, VARIANT_POKE_BALL } from "@/lib/print-variant";

function listing(over: Partial<CtListing> & { props?: Partial<CtListing["properties_hash"]> } = {}): CtListing {
  const { props, ...rest } = over;
  return {
    id: 1,
    blueprint_id: 100,
    name_en: "Primeape",
    expansion: { id: 3316, code: "pal", name_en: "Paldea Evolved" },
    quantity: 1,
    graded: false,
    on_vacation: false,
    price: { cents: 27, currency: "EUR" },
    properties_hash: {
      condition: "Near Mint",
      pokemon_language: "en",
      pokemon_reverse: true,
      signed: false,
      altered: false,
      ...props,
    },
    ...rest,
  };
}

describe("isPublishableReverseListing", () => {
  it("släpper igenom en NM-engelsk reverse-annons", () => {
    expect(isPublishableReverseListing(listing())).toBe(true);
    expect(isPublishableReverseListing(listing({ props: { condition: "Mint" } }))).toBe(true);
  });

  it("kräver att reverse-flaggan ÄR satt — saknad flagga är inte 'kanske'", () => {
    expect(isPublishableReverseListing(listing({ props: { pokemon_reverse: undefined } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { pokemon_reverse: false } }))).toBe(false);
  });

  it("avvisar andra språk och sämre skick", () => {
    expect(isPublishableReverseListing(listing({ props: { pokemon_language: "it" } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { pokemon_language: undefined } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { condition: "Slightly Played" } }))).toBe(false);
  });

  it("avvisar graderat, signerat, altererat och sealed", () => {
    expect(isPublishableReverseListing(listing({ graded: true }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { signed: true } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { altered: true } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ props: { sealed: true } }))).toBe(false);
  });

  it("avvisar det som inte GÅR att köpa", () => {
    expect(isPublishableReverseListing(listing({ on_vacation: true }))).toBe(false);
    expect(isPublishableReverseListing(listing({ quantity: 0 }))).toBe(false);
  });

  it("avvisar annan valuta och orimliga tal", () => {
    expect(isPublishableReverseListing(listing({ price: { cents: 27, currency: "USD" } }))).toBe(false);
    expect(isPublishableReverseListing(listing({ price: { cents: 0, currency: "EUR" } }))).toBe(false);
  });
});

describe("cheapestReverseNmEn", () => {
  it("väljer lägsta priset och rapporterar djupet", () => {
    const got = cheapestReverseNmEn([
      listing({ id: 1, price: { cents: 50, currency: "EUR" } }),
      listing({ id: 2, price: { cents: 27, currency: "EUR" } }),
      listing({ id: 3, price: { cents: 33, currency: "EUR" } }),
    ]);
    expect(got).toEqual({ cents: 27, depth: 3, listingId: 2 });
  });

  it("räknar djupet bara på PUBLICERBARA annonser", () => {
    const got = cheapestReverseNmEn([
      listing({ id: 1, price: { cents: 10, currency: "EUR" }, props: { pokemon_language: "de" } }),
      listing({ id: 2, price: { cents: 27, currency: "EUR" } }),
    ]);
    expect(got).toEqual({ cents: 27, depth: 1, listingId: 2 });
  });

  it("en absurd HÖG annons kan inte förorena ett minimum", () => {
    const got = cheapestReverseNmEn([
      listing({ id: 1, price: { cents: 1_000_064, currency: "EUR" } }),
      listing({ id: 2, price: { cents: 27, currency: "EUR" } }),
    ]);
    expect(got?.cents).toBe(27);
  });

  it("minDepth är skyddet mot att den ENDA annonsen är skräp", () => {
    const thin = [listing({ id: 1, price: { cents: 1_000_064, currency: "EUR" } })];
    expect(cheapestReverseNmEn(thin, 1)?.cents).toBe(1_000_064);
    expect(cheapestReverseNmEn(thin, 2)).toBeNull();
  });

  it("tom eller saknad lista ger null", () => {
    expect(cheapestReverseNmEn([])).toBeNull();
    expect(cheapestReverseNmEn(undefined)).toBeNull();
  });
});

describe("judgeReversePrice", () => {
  const rev = (cents: number, id = 1) =>
    listing({ id, price: { cents, currency: "EUR" } });
  const normal = (cents: number, id = 90) =>
    listing({ id, price: { cents, currency: "EUR" }, props: { pokemon_reverse: false } });

  it("publicerar ett rimligt golv med tillräckligt djup", () => {
    const v = judgeReversePrice([rev(27, 1), rev(40, 2), normal(11)]);
    expect(v.price?.cents).toBe(27);
    expect(v.reason).toBe("none");
    expect(v.ratio).toBeCloseTo(27 / 11);
  });

  it("avvisar ett golv som vilar på EN annons", () => {
    const v = judgeReversePrice([rev(27), normal(11)]);
    expect(v.price).toBeNull();
    expect(v.reason).toBe("thin");
  });

  it("Awakening Drum: två annonser, båda skräp — djupet räcker INTE", () => {
    // Temporal Forces 141, mätt i prod: golv 9,9 M€ på djup 2, baskort ~0,1 €.
    const v = judgeReversePrice([rev(991_041_239, 1), rev(999_999_999, 2), normal(11)]);
    expect(v.price).toBeNull();
    expect(v.reason).toBe("implausible");
  });

  it("Panpour: 21 988 € på djup 2 avvisas också", () => {
    const v = judgeReversePrice([rev(2_198_760, 1), rev(2_500_000, 2), normal(30)]);
    expect(v.price).toBeNull();
    expect(v.reason).toBe("implausible");
  });

  it("10 000 €-placeholdern avvisas — talet återkom identiskt i hela katalogen", () => {
    const v = judgeReversePrice([rev(1_000_000, 1), rev(1_000_000, 2), normal(20)]);
    expect(v.price).toBeNull();
    expect(v.reason).toBe("implausible");
  });

  it("ETT äkta prishopp fälls inte — reverse får kosta mångdubbelt", () => {
    // 20x det ordinarie kortet är högt men fullt verkligt; vakten går vid 50x.
    const v = judgeReversePrice([rev(2000, 1), rev(2500, 2), normal(100)]);
    expect(v.price?.cents).toBe(2000);
    expect(v.reason).toBe("none");
  });

  it("CardTraders EGET ordinarie golv går före den inskickade referensen", () => {
    const v = judgeReversePrice([rev(500, 1), rev(600, 2), normal(100)], {
      fallbackReferenceCents: 1,
    });
    expect(v.referenceCents).toBe(100);
    expect(v.price?.cents).toBe(500);
  });

  it("saknas ordinarie annonser används vårt eget baspris", () => {
    const v = judgeReversePrice([rev(1_000_000, 1), rev(1_000_000, 2)], {
      fallbackReferenceCents: 100,
    });
    expect(v.referenceCents).toBe(100);
    expect(v.reason).toBe("implausible");
  });

  it("utan NÅGON referens faller vi tillbaka på enbart djupkravet", () => {
    const v = judgeReversePrice([rev(27, 1), rev(40, 2)]);
    expect(v.price?.cents).toBe(27);
    expect(v.referenceCents).toBeNull();
    // ...men djupet gäller fortfarande.
    expect(judgeReversePrice([rev(27, 1)]).reason).toBe("thin");
  });

  it("inga reverse-annonser alls ger 'none' utan pris", () => {
    const v = judgeReversePrice([normal(11)]);
    expect(v.price).toBeNull();
    expect(v.reason).toBe("none");
  });

  it("en referens på 0 får inte ge division med noll", () => {
    const v = judgeReversePrice([rev(27, 1), rev(40, 2)], { fallbackReferenceCents: 0 });
    expect(v.price?.cents).toBe(27);
    expect(v.ratio).toBeNull();
  });
});

describe("cheapestNonReverseNmEn", () => {
  it("plockar lägsta ORDINARIE annonsen och ignorerar reverse", () => {
    expect(
      cheapestNonReverseNmEn([
        listing({ id: 1, price: { cents: 5, currency: "EUR" } }), // reverse
        listing({ id: 2, price: { cents: 30, currency: "EUR" }, props: { pokemon_reverse: false } }),
        listing({ id: 3, price: { cents: 50, currency: "EUR" }, props: { pokemon_reverse: undefined } }),
      ])
    ).toBe(30);
  });

  it("null när inga ordinarie annonser finns", () => {
    expect(cheapestNonReverseNmEn([listing()])).toBeNull();
    expect(cheapestNonReverseNmEn([])).toBeNull();
  });
});

describe("ctNumberKey", () => {
  it("nollställer ledande nollor på RENA siffernummer", () => {
    expect(ctNumberKey("007")).toBe("7");
    expect(ctNumberKey("106")).toBe("106");
  });

  it("bevarar suffix — '107h' är ett ANNAT kort än '107'", () => {
    expect(ctNumberKey("107h")).toBe("107h");
    expect(ctNumberKey("107")).toBe("107");
    expect(ctNumberKey("107h")).not.toBe(ctNumberKey("107"));
  });

  it("bevarar bokstavsnumrering (TG/GG/SWSH)", () => {
    expect(ctNumberKey("TG07")).toBe("tg07");
    expect(ctNumberKey("SWSH034")).toBe("swsh034");
  });

  it("strippar totalen — äldre set skriver '001/149', inte '001'", () => {
    expect(ctNumberKey("001/149")).toBe("1");
    expect(ctNumberKey("107/193")).toBe("107");
    // Samma kort, två skrivsätt, SAMMA nyckel — annars faller hela set ur tyst.
    expect(ctNumberKey("001/149")).toBe(ctNumberKey("1"));
  });

  it("suffix överlever totalstrippningen", () => {
    expect(ctNumberKey("107h/193")).toBe("107h");
    expect(ctNumberKey("TG07/30")).toBe("tg07");
  });

  it("tomt ger null", () => {
    expect(ctNumberKey("")).toBeNull();
    expect(ctNumberKey(null)).toBeNull();
    expect(ctNumberKey(undefined)).toBeNull();
  });
});

describe("ctSetNameKey", () => {
  it("gör diakriter och skiljetecken irrelevanta", () => {
    expect(ctSetNameKey("Pokémon GO")).toBe(ctSetNameKey("Pokemon GO"));
    expect(ctSetNameKey("Sword & Shield")).toBe("sword and shield");
    expect(ctSetNameKey("Sword & Shield: Rebel Clash")).toBe("sword and shield rebel clash");
  });
});

describe("matchExpansion", () => {
  const exps: CtExpansion[] = [
    { id: 3316, game_id: 5, code: "pal", name: "Paldea Evolved" },
    { id: 1503, game_id: 5, code: "exd", name: "EX Deoxys" },
    { id: 1496, game_id: 5, code: "exdr", name: "EX Dragon" },
    { id: 1514, game_id: 5, code: "exdf", name: "EX Dragon Frontiers" },
    { id: 1553, game_id: 5, code: "dv", name: "Dragon Vault" },
    { id: 1541, game_id: 5, code: "tm", name: "Triumphant" },
    { id: 1878, game_id: 5, code: "pla", name: "Platinum Arceus" },
    { id: 2018, game_id: 5, code: "aoa", name: "Advent of Arceus" },
    { id: 1472, game_id: 5, code: "bs", name: "Base Set" },
    { id: 1969, game_id: 5, code: "bss", name: "Base Set Shadowless" },
    { id: 3268, game_id: 5, code: "svp", name: "Scarlet & Violet Promos" },
  ];

  it("matchar exakt namn", () => {
    expect(matchExpansion("Paldea Evolved", "Scarlet & Violet", exps)?.id).toBe(3316);
  });

  it("EX-prefixet gäller BARA EX-serien", () => {
    expect(matchExpansion("Deoxys", "EX", exps)?.id).toBe(1503);
    // Samma namn ur en annan serie får INTE prefixas in i EX-eran.
    expect(matchExpansion("Deoxys", "Sword & Shield", exps)).toBeNull();
  });

  it("'Dragon' ur EX-serien blir EX Dragon, inte Dragon Vault", () => {
    expect(matchExpansion("Dragon", "EX", exps)?.id).toBe(1496);
  });

  it("strippar HS-prefixet", () => {
    expect(matchExpansion("HS—Triumphant", "HeartGold & SoulSilver", exps)?.id).toBe(1541);
  });

  it("Platinum-prefixet väljer rätt Arceus", () => {
    expect(matchExpansion("Arceus", "Platinum", exps)?.id).toBe(1878);
  });

  it("Base → Base Set, och Shadowless förblir en EGEN expansion", () => {
    expect(matchExpansion("Base", "Base", exps)?.id).toBe(1472);
  });

  it("Black Star Promos → Promos", () => {
    expect(matchExpansion("Scarlet & Violet Black Star Promos", "Scarlet & Violet", exps)?.id).toBe(3268);
  });

  it("okänt set ger null i stället för en gissning", () => {
    expect(matchExpansion("Hittepå-setet", "Other", exps)).toBeNull();
  });

  it("tvetydigt namn ger null — aldrig ett myntkast", () => {
    const dupes: CtExpansion[] = [
      { id: 1, game_id: 5, code: "a", name: "Promos" },
      { id: 2, game_id: 5, code: "b", name: "Promos" },
    ];
    expect(matchExpansion("Promos", "Other", dupes)).toBeNull();
  });
});

describe("shouldDistrustDexTaxonomy", () => {
  // Argumenten är SETETS reverse-antal och SETETS kortantal — inte hur många
  // kandidater marknaden råkade ge. Se regeln i cardtrader.ts.
  it("ETT enda reverse=true bevisar att setet är ifyllt — då gäller nejen", () => {
    expect(shouldDistrustDexTaxonomy(176, 279)).toBe(false); // Paldea Evolved
    expect(shouldDistrustDexTaxonomy(67, 120)).toBe(false); // Pitch Black
    expect(shouldDistrustDexTaxonomy(1, 300)).toBe(false);
  });

  it("noll reverse i ett helt set = oanvändbar taxonomi", () => {
    expect(shouldDistrustDexTaxonomy(0, 120)).toBe(true); // Chaos Rising, ofyllt
    expect(shouldDistrustDexTaxonomy(0, 111)).toBe(true); // EX Team Rocket Returns, felmärkt som holo
    expect(shouldDistrustDexTaxonomy(0, 140)).toBe(true); // Legendary Treasures
  });

  it("ett litet set utan reverse holos utlöser inte misstanken", () => {
    expect(shouldDistrustDexTaxonomy(0, 5)).toBe(false);
    expect(shouldDistrustDexTaxonomy(0, 19)).toBe(false);
    expect(shouldDistrustDexTaxonomy(0, 20)).toBe(true);
  });

  it("tomt set är inte misstänkt", () => {
    expect(shouldDistrustDexTaxonomy(0, 0)).toBe(false);
  });

  it("⛔ MARKNADSDJUPET FÅR INTE PÅVERKA DOMEN — regressionen som tömde ex7/8/9", () => {
    // Samma set (111 kort, 0 reverse hos TCGdex) ska dömas likadant vare sig
    // CardTrader råkade ha 9 eller 27 kandidater. Den gamla signaturen tog
    // kandidatantalet och gav därför olika svar för grannset ur samma era.
    expect(shouldDistrustDexTaxonomy(0, 111)).toBe(true);
    expect(shouldDistrustDexTaxonomy(0, 116)).toBe(true);
  });
});

describe("blueprint-hjälpare", () => {
  const bp = (over: Partial<CtBlueprint> = {}): CtBlueprint => ({
    id: 1,
    name: "Primeape",
    version: "107/193",
    game_id: 5,
    category_id: 73,
    expansion_id: 3316,
    fixed_properties: { collector_number: "107" },
    editable_properties: [{ name: "condition" }, { name: "pokemon_reverse" }],
    card_market_ids: [1],
    tcg_player_id: null,
    image_url: null,
    ...over,
  });

  it("singel = har collector_number; sealed har det inte", () => {
    expect(isSingleBlueprint(bp())).toBe(true);
    expect(isSingleBlueprint(bp({ fixed_properties: {} }))).toBe(false);
  });

  it("reverse-förmåga läses ur editable_properties", () => {
    expect(blueprintAllowsReverse(bp())).toBe(true);
    expect(blueprintAllowsReverse(bp({ editable_properties: [{ name: "condition" }] }))).toBe(false);
  });
});

describe("matchBallExpansions", () => {
  const exps = (names: string[]) =>
    names.map((name, i) => ({ id: 4000 + i, game_id: 5, code: `c${i}`, name }));

  it("hittar setets Master Ball- och Poké Ball-expansioner", () => {
    const list = exps([
      "Prismatic Evolutions",
      "Prismatic Evolutions - Master Ball Reverse Holo",
      "Prismatic Evolutions - Poké Ball Reverse Holo",
      "Black Bolt - Master Ball Reverse Holo",
    ]);
    const hits = matchBallExpansions("Prismatic Evolutions", list);
    expect(hits.map((h) => h.label)).toEqual([VARIANT_MASTER_BALL, VARIANT_POKE_BALL]);
    expect(hits[0].expansion.name).toBe("Prismatic Evolutions - Master Ball Reverse Holo");
  });

  it("⛔ tar INTE ett annat sets bollexpansion", () => {
    // "151" och "Collect 151" är olika set, och de japanska motsvarigheterna
    // (sv2a, sv8a, sv11W/B) bär nästan identiska namn.
    const list = exps([
      "Collect 151 - Master ball Reverse Holo",
      "Pokémon Card 151 - Master Ball Reverse Holo",
    ]);
    expect(matchBallExpansions("151", list)).toEqual([]);
  });

  it("grundsetet självt är ingen bollexpansion", () => {
    expect(matchBallExpansions("Black Bolt", exps(["Black Bolt"]))).toEqual([]);
  });
});

describe("ctNamesAgree — numret ensamt räcker inte (2026-08-30)", () => {
  it("släpper igenom CT:s stavningar av samma kort", () => {
    expect(ctNamesAgree("Nidoran M (JP)", "Nidoran ♂")).toBe(true);
    expect(ctNamesAgree("Farfetchd (JP)", "Farfetch'd")).toBe(true);
    expect(ctNamesAgree("Erikas Invitation (JP)", "Erika's Invitation")).toBe(true);
    expect(ctNamesAgree("Antique Old Amber (JP)", "Old Old Amber")).toBe(true);
    expect(ctNamesAgree("Professor Sadas Vitality (JP)", "Professor Sada's Vitality")).toBe(true);
    expect(ctNamesAgree("Umbreon ex", "Umbreon ex")).toBe(true);
  });

  it("⛔ fäller ett annat kort på samma nummer (Espeon ex fick Duskulls pris)", () => {
    expect(ctNamesAgree("Espeon ex (JP)", "Duskull")).toBe(false);
    expect(ctNamesAgree("Bloodmoon Ursaluna ex (JP)", "Iron Jugulis")).toBe(false);
    expect(ctNamesAgree("Pikachu", "Raichu")).toBe(false);
  });
});

describe("matchJpBallExpansions (2026-08-30)", () => {
  const exps = (names: string[]) =>
    names.map((name, i) => ({ id: 4000 + i, game_id: 5, code: `c${i}`, name }));
  const enKeys = new Set(["151", "black bolt", "white flare", "prismatic evolutions"].map(ctSetNameKey));

  it("koden i vårt namn matchar CT:s '<namn> | <kod>'-form", () => {
    const list = exps([
      "Black Bolt - Master Ball Reverse Holo",
      "Black Bolt | sv11B - Master Ball Reverse Holo",
      "Black Bolt | sv11B - Poké Ball Reverse Holo",
      "Black Bolt - Poké Ball Reverse Holo",
    ]);
    const hits = matchJpBallExpansions("Black Bolt (SV11B)", list, enKeys);
    expect(hits.map((h) => h.expansion.name)).toEqual([
      "Black Bolt | sv11B - Master Ball Reverse Holo",
      "Black Bolt | sv11B - Poké Ball Reverse Holo",
    ]);
  });

  it("bart namn duger när CT saknar kod och inget ENGELSKT set heter så", () => {
    const list = exps([
      "Pokémon Card 151 - Master Ball Reverse Holo",
      "Pokémon Card 151 - Poké Ball Reverse Holo",
      "Collect 151 - Master ball Reverse Holo",
    ]);
    const hits = matchJpBallExpansions("Pokémon Card 151 (SV2a)", list, enKeys);
    expect(hits.map((h) => [h.label, h.expansion.id])).toEqual([
      [VARIANT_MASTER_BALL, 4000],
      [VARIANT_POKE_BALL, 4001],
    ]);
  });

  it("⛔ tar ALDRIG den engelska expansionen när namnet delas med ett EN-set", () => {
    // Utan kodformen hos CT och med "Black Bolt" som engelskt set: inget val,
    // hellre inget golv än ett engelskt golv på ett japanskt kort.
    const list = exps(["Black Bolt - Master Ball Reverse Holo"]);
    expect(matchJpBallExpansions("Black Bolt (SV11B)", list, enKeys)).toEqual([]);
  });

  it("⛔ 'Ball & Rocket' är ingen boll-etikett", () => {
    const list = exps(["MEGA Dream ex - Ball & Rocket Reverse Holo"]);
    expect(matchJpBallExpansions("MEGA Dream ex (M2a)", list, enKeys)).toEqual([]);
  });

  it("isBuyableNmListing: jp-annonser passerar bara med språket jp", () => {
    const jp = listing({ props: { pokemon_language: "jp" } });
    expect(isBuyableNmListing(jp, "jp")).toBe(true);
    expect(isBuyableNmListing(jp, "en")).toBe(false);
    expect(isBuyableNmListing(listing(), "jp")).toBe(false);
  });

  it("tvetydigt (två med samma namn) ger ingen träff — aldrig ett myntkast", () => {
    const list = exps([
      "White Flare - Master Ball Reverse Holo",
      "White Flare - Master Ball Reverse Holo",
    ]);
    expect(matchBallExpansions("White Flare", list)).toEqual([]);
  });
});
