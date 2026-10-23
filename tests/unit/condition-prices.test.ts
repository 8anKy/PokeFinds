import { describe, expect, it } from "vitest";
import type { CtListing } from "@/lib/cardtrader";
import {
  CONDITION_MAX_AGE_DAYS,
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
      GOOD: { ore: 660, n: 2 },
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
  const now = new Date("2026-10-23T12:00:00Z");
  const at = "2026-10-22T05:00:00Z";
  const raw = { NEAR_MINT: { ore: 9999, n: 5 }, PLAYED: { ore: 2244, n: 3 } };

  it("NM tas ur rubriken, aldrig ur CardTraders NM-golv; saknade skick är null", () => {
    const table = conditionPriceTable(raw, at, 6105, now)!;
    expect(table.at).toBe(new Date(at).toISOString());
    const byCond = Object.fromEntries(table.rows.map((r) => [r.condition, r]));
    expect(byCond.NEAR_MINT).toEqual({ condition: "NEAR_MINT", ore: 6105, n: 0, source: "headline" });
    expect(byCond.PLAYED).toEqual({ condition: "PLAYED", ore: 2244, n: 3, source: "cardtrader" });
    expect(byCond.GOOD).toEqual({ condition: "GOOD", ore: null, n: 0, source: null });
    expect(table.rows.map((r) => r.condition)).toEqual(["MINT", "NEAR_MINT", "EXCELLENT", "GOOD", "PLAYED", "POOR"]);
  });

  it("utan rubrikpris blir NM '–', inte CardTraders tal", () => {
    const table = conditionPriceTable(raw, at, null, now)!;
    expect(table.rows.find((r) => r.condition === "NEAR_MINT")?.ore).toBeNull();
  });

  it("bara ett NM-golv från CardTrader ⇒ ingen tabell", () => {
    expect(conditionPriceTable({ NEAR_MINT: { ore: 100, n: 4 } }, at, 6105, now)).toBeNull();
  });

  it(`äldre än ${CONDITION_MAX_AGE_DAYS} dygn ⇒ ingen tabell`, () => {
    expect(conditionPriceTable(raw, "2026-10-01T00:00:00Z", 6105, now)).toBeNull();
    expect(conditionPriceTable(raw, null, 6105, now)).toBeNull();
  });
});

describe("priceForCondition", () => {
  it("utan tabell är bara NM känt, ur rubriken", () => {
    expect(priceForCondition(null, "NEAR_MINT", 801).ore).toBe(801);
    expect(priceForCondition(null, "POOR", 801)).toEqual({ condition: "POOR", ore: null, n: 0, source: null });
  });

  it("ett skick utan pris får aldrig rubrikpriset i sitt ställe", () => {
    const table = conditionPriceTable({ PLAYED: { ore: 500, n: 2 } }, "2026-10-22T00:00:00Z", 801, new Date("2026-10-23T00:00:00Z"));
    expect(priceForCondition(table, "POOR", 801).ore).toBeNull();
    expect(priceForCondition(table, "PLAYED", 801)).toMatchObject({ ore: 500, source: "cardtrader" });
  });
});
