import { describe, expect, it } from "vitest";
import type { CtListing } from "@/lib/cardtrader";
import {
  CONDITION_PERCENT,
  conditionFloors,
  conditionPriceTable,
  isConditionListing,
  parseConditionPrices,
  priceForCondition,
} from "@/lib/condition-prices";

let nextId = 1;
function listing(cents: number, props: Partial<CtListing["properties_hash"]> = {}, over: Partial<CtListing> = {}): CtListing {
  return {
    id: nextId++,
    blueprint_id: 1,
    name_en: "Eevee",
    expansion: { id: 1, code: "uf", name_en: "EX Unseen Forces" },
    quantity: 1,
    graded: false,
    on_vacation: false,
    price: { cents, currency: "EUR" },
    properties_hash: { condition: "Near Mint", pokemon_language: "en", ...props },
    ...over,
  };
}

const NORMAL = { reverse: false, firstEdition: false };
const REVERSE = { reverse: true, firstEdition: false };
const EUR_TO_ORE = 1100;

describe("isConditionListing", () => {
  it("räknar bara köpbara engelska annonser i rätt tryckning", () => {
    expect(isConditionListing(listing(100, { condition: "Played" }), NORMAL)).toBe(true);
    expect(isConditionListing(listing(100, { pokemon_language: "de" }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, { pokemon_reverse: true }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, {}), REVERSE)).toBe(false);
    expect(isConditionListing(listing(100, { pokemon_reverse: true }), REVERSE)).toBe(true);
    expect(isConditionListing(listing(100, { first_edition: true }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, {}, { graded: true }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, {}, { on_vacation: true }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, {}, { quantity: 0 }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, { condition: "Heavily Damaged" }), NORMAL)).toBe(false);
    expect(isConditionListing(listing(100, { signed: true }), NORMAL)).toBe(false);
  });
});

describe("conditionFloors", () => {
  it("mappar CardTraders skick 1:1 och tar lägsta annonsen per skick", () => {
    const floors = conditionFloors(
      [
        listing(321, { condition: "Near Mint" }),
        listing(400, { condition: "Near Mint" }),
        listing(210, { condition: "Slightly Played" }),
        listing(250, { condition: "Slightly Played" }),
        listing(60, { condition: "Moderately Played" }),
        listing(90, { condition: "Moderately Played" }),
        listing(204, { condition: "Played" }),
        listing(300, { condition: "Played" }),
        listing(203, { condition: "Poor" }),
        listing(500, { condition: "Poor" }),
      ],
      NORMAL,
      EUR_TO_ORE
    );
    expect(floors).toEqual({
      NEAR_MINT: { ore: 3531, n: 2 },
      EXCELLENT: { ore: 2310, n: 2 },
      LIGHT_PLAYED: { ore: 660, n: 2 },
      PLAYED: { ore: 2244, n: 2 },
      POOR: { ore: 2233, n: 2 },
    });
  });

  it("publicerar inget skick med färre än två annonser (Charizard SW 3: EN NM-annons à 40,52 €)", () => {
    const floors = conditionFloors(
      [listing(4052, { condition: "Near Mint" }), listing(2769, { condition: "Played" }), listing(3000, { condition: "Played" })],
      NORMAL,
      EUR_TO_ORE
    );
    expect(floors.NEAR_MINT).toBeUndefined();
    expect(floors.PLAYED).toEqual({ ore: 30459, n: 2 });
  });

  it("håller isär reverse och ordinarie tryckning", () => {
    const ls = [
      listing(100, { condition: "Played" }),
      listing(110, { condition: "Played" }),
      listing(900, { condition: "Played", pokemon_reverse: true }),
      listing(950, { condition: "Played", pokemon_reverse: true }),
    ];
    expect(conditionFloors(ls, NORMAL, EUR_TO_ORE).PLAYED?.ore).toBe(1100);
    expect(conditionFloors(ls, REVERSE, EUR_TO_ORE).PLAYED?.ore).toBe(9900);
  });

  it("tom eller saknad lista ger tomt objekt", () => {
    expect(conditionFloors(undefined, NORMAL, EUR_TO_ORE)).toEqual({});
  });
});

describe("parseConditionPrices", () => {
  it("släpper skräp, aldrig ett kast", () => {
    expect(parseConditionPrices(null)).toEqual({});
    expect(parseConditionPrices("x")).toEqual({});
    expect(parseConditionPrices([1])).toEqual({});
    expect(parseConditionPrices({ PLAYED: { ore: 0, n: 2 }, GOOD: { ore: 10, n: "a" }, POOR: { ore: 5, n: 3 } })).toEqual({
      POOR: { ore: 5, n: 3 },
    });
  });
});

describe("conditionPriceTable", () => {
  it("NM = rubriken, övriga skick = procent av NM (kort under 100 kr)", () => {
    const table = conditionPriceTable(5000)!;
    const byCond = Object.fromEntries(table.rows.map((r) => [r.condition, r]));
    expect(byCond.NEAR_MINT).toEqual({ condition: "NEAR_MINT", ore: 5000, percent: 100, source: "headline" });
    expect(byCond.MINT).toMatchObject({ ore: 5000, percent: 100, source: "estimate" });
    expect(byCond.EXCELLENT).toMatchObject({ ore: 4750, percent: 95 });
    expect(byCond.GOOD).toMatchObject({ ore: 4000, percent: 80 });
    expect(byCond.LIGHT_PLAYED).toMatchObject({ ore: 3150, percent: 63 });
    expect(byCond.PLAYED).toMatchObject({ ore: 2200, percent: 44 });
    expect(byCond.POOR).toMatchObject({ ore: 1650, percent: 33 });
    expect(table.rows.map((r) => r.condition)).toEqual([
      "MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "LIGHT_PLAYED", "PLAYED", "POOR",
    ]);
  });

  it("från 100 kr gäller den brantare tabellen", () => {
    const table = conditionPriceTable(10_000)!;
    const ex = table.rows.find((r) => r.condition === "EXCELLENT")!;
    const poor = table.rows.find((r) => r.condition === "POOR")!;
    expect(ex).toMatchObject({ ore: 9200, percent: CONDITION_PERCENT.high.EXCELLENT });
    expect(poor).toMatchObject({ ore: 2500, percent: 25 });
  });

  it("inget NM-pris ⇒ ingen tabell (aldrig ett påhittat tal)", () => {
    expect(conditionPriceTable(null)).toBeNull();
    expect(conditionPriceTable(0)).toBeNull();
  });

  it("tabellerna sjunker med skicket och NM/Mint är alltid 100", () => {
    for (const band of ["low", "high"] as const) {
      const t = CONDITION_PERCENT[band];
      expect(t.MINT).toBe(100);
      expect(t.NEAR_MINT).toBe(100);
      const ladder = [t.EXCELLENT, t.GOOD, t.LIGHT_PLAYED, t.PLAYED, t.POOR];
      expect([...ladder].sort((a, b) => b - a)).toEqual(ladder);
    }
  });
});

describe("priceForCondition", () => {
  it("utan tabell räknas skicket ur rubriken", () => {
    expect(priceForCondition(null, "NEAR_MINT", 801)).toMatchObject({ ore: 801, source: "headline" });
    expect(priceForCondition(null, "POOR", 801)).toMatchObject({ ore: 264, percent: 33, source: "estimate" });
  });

  it("utan rubrikpris är alla skick '–'", () => {
    expect(priceForCondition(null, "PLAYED", null)).toEqual({ condition: "PLAYED", ore: null, percent: 0, source: null });
  });

  it("en äldre cachad CardTrader-tabell ignoreras och räknas om ur NM", () => {
    const old = {
      rows: [
        { condition: "NEAR_MINT", ore: 1000, percent: 100, source: "headline" },
        { condition: "PLAYED", ore: 9999, percent: 0, source: "cardtrader" },
      ],
    } as unknown as Parameters<typeof priceForCondition>[0];
    expect(priceForCondition(old, "PLAYED", null)).toMatchObject({ ore: 440, source: "estimate" });
  });
});
