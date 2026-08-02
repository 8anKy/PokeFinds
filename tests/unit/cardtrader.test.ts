import { describe, expect, it } from "vitest";
import {
  blueprintAllowsReverse,
  cheapestReverseNmEn,
  ctNumberKey,
  ctSetNameKey,
  isPublishableReverseListing,
  isSingleBlueprint,
  matchExpansion,
  type CtBlueprint,
  type CtExpansion,
  type CtListing,
} from "@/lib/cardtrader";

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
