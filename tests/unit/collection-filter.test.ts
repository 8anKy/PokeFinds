import { describe, expect, it } from "vitest";
import {
  filterCollectionRows,
  groupTotalValue,
  sortCollectionGroups,
} from "@/app/[locale]/(portfolio)/samling/collection-filter";
import { groupCollectionLots, type LotRow } from "@/app/[locale]/(portfolio)/samling/profit";

type Row = LotRow & { name: string; setName: string | null };

function row(over: Partial<Row> & { id: string; name: string }): Row {
  return {
    cardId: over.id,
    productId: null,
    quantity: 1,
    condition: "NEAR_MINT",
    language: "EN",
    gradingCompany: null,
    grade: null,
    purchasePrice: null,
    estimatedValue: 10000,
    purchaseDate: null,
    setName: null,
    ...over,
  };
}

describe("filterCollectionRows", () => {
  const rows = [
    row({ id: "a", name: "Charizard ex", setName: "Obsidian Flames" }),
    row({ id: "b", name: "Pikachu VMAX", setName: "Vivid Voltage" }),
    row({ id: "c", name: "Blastoise", setName: null }),
  ];

  it("matchar på namn OCH setnamn, oberoende av versaler", () => {
    expect(filterCollectionRows(rows, "chari").map((r) => r.id)).toEqual(["a"]);
    expect(filterCollectionRows(rows, "VIVID").map((r) => r.id)).toEqual(["b"]);
  });

  it("kräver att ALLA ord träffar (AND), i valfri ordning", () => {
    expect(filterCollectionRows(rows, "obsidian charizard").map((r) => r.id)).toEqual(["a"]);
    expect(filterCollectionRows(rows, "charizard vivid")).toEqual([]);
  });

  it("tom sökning returnerar samma referens (ingen omräkning nedströms)", () => {
    expect(filterCollectionRows(rows, "   ")).toBe(rows);
  });
});

describe("sortCollectionGroups", () => {
  it("värde: högst först, och OKÄNT värde alltid SIST (aldrig som 0 kr)", () => {
    const groups = groupCollectionLots([
      row({ id: "billig", name: "Billig", estimatedValue: 5000 }),
      row({ id: "okand", name: "Okänd", estimatedValue: null }),
      row({ id: "dyr", name: "Dyr", estimatedValue: 90000 }),
      // Gratis är ett ÄKTA värde och ska sorteras som 0 — under det billiga,
      // men fortfarande FÖRE det okända.
      row({ id: "noll", name: "Noll", estimatedValue: 0 }),
    ]);
    expect(sortCollectionGroups(groups, "value").map((g) => g.lots[0].id)).toEqual([
      "dyr",
      "billig",
      "noll",
      "okand",
    ]);
  });

  it("värde räknas på HELA posten (per styck × antal)", () => {
    const groups = groupCollectionLots([
      row({ id: "en", name: "En", estimatedValue: 20000, quantity: 1 }),
      row({ id: "manga", name: "Många", estimatedValue: 5000, quantity: 10 }),
    ]);
    expect(sortCollectionGroups(groups, "value").map((g) => g.lots[0].id)).toEqual([
      "manga",
      "en",
    ]);
  });

  it("summerar bara poster som HAR ett värde, och ger null när ingen har det", () => {
    expect(groupTotalValue([{ name: "x", quantity: 2, estimatedValue: 1500 }])).toBe(3000);
    expect(
      groupTotalValue([
        { name: "x", quantity: 2, estimatedValue: 1500 },
        { name: "x", quantity: 3, estimatedValue: null },
      ])
    ).toBe(3000);
    expect(groupTotalValue([{ name: "x", quantity: 2, estimatedValue: null }])).toBeNull();
  });

  it("senast tillagd = serverns ordning, orörd", () => {
    const groups = groupCollectionLots([
      row({ id: "ny", name: "Ö" }),
      row({ id: "gammal", name: "A" }),
    ]);
    expect(sortCollectionGroups(groups, "recent").map((g) => g.lots[0].id)).toEqual([
      "ny",
      "gammal",
    ]);
  });

  it("namn A–Ö sorteras svenskt (å/ä/ö sist)", () => {
    const groups = groupCollectionLots([
      row({ id: "3", name: "Ödla" }),
      row({ id: "1", name: "Abra" }),
      row({ id: "2", name: "Zubat" }),
    ]);
    expect(sortCollectionGroups(groups, "name").map((g) => g.lots[0].id)).toEqual(["1", "2", "3"]);
  });

  it("sorteringen är stabil vid lika värden", () => {
    const groups = groupCollectionLots([
      row({ id: "a", name: "A", estimatedValue: 1000 }),
      row({ id: "b", name: "B", estimatedValue: 1000 }),
      row({ id: "c", name: "C", estimatedValue: 1000 }),
    ]);
    expect(sortCollectionGroups(groups, "value").map((g) => g.lots[0].id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("grupperingen bygger på POSTER: två köp av samma vara är EN rad med båda kvar", () => {
    const rows = [
      row({ id: "kop-1", cardId: "card-x", name: "Charizard", purchasePrice: 30000 }),
      row({ id: "kop-2", cardId: "card-x", name: "Charizard", purchasePrice: 40000 }),
    ];
    const groups = sortCollectionGroups(groupCollectionLots(rows), "value");
    expect(groups).toHaveLength(1);
    expect(groups[0].lots.map((l) => l.purchasePrice)).toEqual([30000, 40000]);
  });
});
