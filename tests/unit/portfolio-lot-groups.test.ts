import { describe, expect, it } from "vitest";
import {
  groupCollectionLots,
  groupProfit,
  groupUnitValue,
  rowProfit,
  type LotRow,
} from "@/app/[locale]/(app)/samling/profit";

function lot(over: Partial<LotRow> & { id: string }): LotRow {
  return {
    cardId: "card-1",
    productId: null,
    quantity: 1,
    condition: "NEAR_MINT",
    language: "EN",
    gradingCompany: null,
    grade: null,
    purchasePrice: null,
    estimatedValue: 50000,
    purchaseDate: null,
    ...over,
  };
}

describe("groupCollectionLots", () => {
  it("slår ihop köp av samma vara och håller isär olika varor", () => {
    const groups = groupCollectionLots([
      lot({ id: "a", purchasePrice: 30000 }),
      lot({ id: "b", cardId: "card-2" }),
      lot({ id: "c", purchasePrice: 40000 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lots.map((l) => l.id)).toEqual(["a", "c"]);
    expect(groups[0].quantity).toBe(2);
    expect(groups[0].averagePaid).toBe(35000);
  });

  it("visar köpen KRONOLOGISKT, odaterade sist", () => {
    const [g] = groupCollectionLots([
      lot({ id: "utan-datum" }),
      lot({ id: "juli", purchaseDate: "2026-07-12T00:00:00.000Z" }),
      lot({ id: "juni", purchaseDate: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(g.lots.map((l) => l.id)).toEqual(["juni", "juli", "utan-datum"]);
  });

  it("slår ALDRIG ihop två fritext-poster — de saknar katalogidentitet", () => {
    // Utan den syntetiska identiteten ger lotKey båda nyckeln "||NEAR_MINT|EN||"
    // och "Min pärm" hade redovisats ihop med "Blandad lot".
    const groups = groupCollectionLots([
      lot({ id: "parm", cardId: null, productId: null }),
      lot({ id: "lot", cardId: null, productId: null }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("returnerar ORIGINALobjekten, inte grupperingens shim", () => {
    const original = lot({ id: "fritext", cardId: null, productId: null });
    const [g] = groupCollectionLots([original]);
    expect(g.lots[0]).toBe(original);
    expect(g.lots[0].cardId).toBeNull();
  });
});

describe("groupProfit", () => {
  it("summerar posternas vinst och räknar procent mot faktisk kostnadsbas", () => {
    // 300 kr + 400 kr betalt, 500 kr värde per styck → +300 kr på 700 kr.
    const pl = groupProfit([
      lot({ id: "a", purchasePrice: 30000 }),
      lot({ id: "b", purchasePrice: 40000 }),
    ]);
    expect(pl?.amount).toBe(30000);
    expect(pl?.percent).toBeCloseTo((30000 / 70000) * 100, 6);
  });

  it("hoppar över prislösa poster — de har ingen kostnadsbas att räkna på", () => {
    const pl = groupProfit([
      lot({ id: "utan", quantity: 3 }),
      lot({ id: "med", purchasePrice: 40000 }),
    ]);
    // Bara den prissatta posten: 500 − 400 = +100 kr. De tre andra bidrar INTE
    // med 3 × 500 kr "gratis vinst".
    expect(pl?.amount).toBe(10000);
  });

  it("ger null när ingen post har köppris — aldrig 0 kr", () => {
    expect(groupProfit([lot({ id: "a" }), lot({ id: "b" })])).toBeNull();
  });

  it("är IDENTISK med rowProfit för en ensam post (gamla rutan är oförändrad)", () => {
    const only = lot({ id: "a", quantity: 3, purchasePrice: 30000, estimatedValue: 50000 });
    expect(groupProfit([only])).toEqual(rowProfit(only));
  });
});

describe("groupUnitValue", () => {
  it("väger värdet per styck på antal", () => {
    expect(
      groupUnitValue([
        lot({ id: "a", quantity: 3, estimatedValue: 10000 }),
        lot({ id: "b", quantity: 1, estimatedValue: 50000 }),
      ])
    ).toBe(20000);
  });

  it("utelämnar poster utan värde i BÅDE täljare och nämnare", () => {
    expect(
      groupUnitValue([
        lot({ id: "a", quantity: 3, estimatedValue: null }),
        lot({ id: "b", quantity: 1, estimatedValue: 50000 }),
      ])
    ).toBe(50000);
  });

  it("ger null när ingen post har värde", () => {
    expect(groupUnitValue([lot({ id: "a", estimatedValue: null })])).toBeNull();
  });

  it("ger exakt postens eget värde för en ensam post", () => {
    expect(groupUnitValue([lot({ id: "a", quantity: 7, estimatedValue: 12345 })])).toBe(12345);
  });
});
