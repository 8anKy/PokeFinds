import { describe, expect, it } from "vitest";
import { canStackOnto, groupLots, lotKey, type LotLike } from "@/lib/collection-lots";

function lot(over: Partial<LotLike> & { id: string }): LotLike {
  return {
    cardId: "card-1",
    productId: null,
    quantity: 1,
    condition: "NEAR_MINT",
    language: "EN",
    gradingCompany: null,
    grade: null,
    purchasePrice: null,
    ...over,
  };
}

describe("canStackOnto", () => {
  it("stackar när båda saknar pris — två prislösa tillägg är samma post", () => {
    expect(canStackOnto(null, null)).toBe(true);
    expect(canStackOnto(undefined, undefined)).toBe(true);
    expect(canStackOnto(null, undefined)).toBe(true);
  });

  it("stackar när priset är EXAKT detsamma", () => {
    expect(canStackOnto(30000, 30000)).toBe(true);
  });

  it("stackar INTE när priserna skiljer sig — annars kastas det nya priset", () => {
    expect(canStackOnto(30000, 40000)).toBe(false);
  });

  it("stackar INTE in ett pris i en prislös post — de gamla exemplaren hade inget", () => {
    expect(canStackOnto(null, 40000)).toBe(false);
  });

  it("stackar INTE ett prislöst köp på en prissatt post — posten hade ljugit om antalet", () => {
    expect(canStackOnto(30000, null)).toBe(false);
  });

  it("0 kr är ett PRIS (köpt gratis), inte samma sak som saknat", () => {
    expect(canStackOnto(0, null)).toBe(false);
    expect(canStackOnto(0, 0)).toBe(true);
  });
});

describe("lotKey", () => {
  it("skiljer INTE på pris — samma vara, olika köp hör ihop", () => {
    expect(lotKey(lot({ id: "a", purchasePrice: 30000 }))).toBe(
      lotKey(lot({ id: "b", purchasePrice: 40000 }))
    );
  });

  it("skiljer på skick, språk och gradering", () => {
    const base = lot({ id: "a" });
    expect(lotKey(base)).not.toBe(lotKey({ ...base, condition: "PLAYED" }));
    expect(lotKey(base)).not.toBe(lotKey({ ...base, language: "JP" }));
    expect(lotKey(base)).not.toBe(lotKey({ ...base, grade: "10" }));
  });

  it("grupperar ALDRIG ihop fritextposter — de har ingen delad identitet", () => {
    // Utan undantaget blev nyckeln "||NEAR_MINT|EN||" för varenda fritextpost,
    // och hela fritextsamlingen slogs ihop till EN rad med ett påhittat snitt.
    const a = lot({ id: "a", cardId: null, productId: null, purchasePrice: 10000 });
    const b = lot({ id: "b", cardId: null, productId: null, purchasePrice: 90000 });
    expect(lotKey(a)).not.toBe(lotKey(b));
    expect(groupLots([a, b])).toHaveLength(2);
  });

  it("skiljer på TRYCKNING — Base Unlimited och 1st Edition är olika varor", () => {
    expect(lotKey(lot({ id: "a", productId: "unlimited" }))).not.toBe(
      lotKey(lot({ id: "b", productId: "first-ed" }))
    );
  });
});

describe("groupLots", () => {
  it("väger snittet på ANTAL, inte på antal köp", () => {
    // 3 ex à 100 + 1 ex à 500 = 800 / 4 = 200 (ett ovägt snitt hade gett 300).
    const [g] = groupLots([
      lot({ id: "a", quantity: 3, purchasePrice: 10000 }),
      lot({ id: "b", quantity: 1, purchasePrice: 50000 }),
    ]);
    expect(g.quantity).toBe(4);
    expect(g.costedQuantity).toBe(4);
    expect(g.totalPaid).toBe(80000);
    expect(g.averagePaid).toBe(20000);
  });

  it("räknar snittet BARA på prissatta exemplar och säger hur många de är", () => {
    // Vår verkliga situation: gamla poster saknar pris med flit.
    const [g] = groupLots([
      lot({ id: "gammal", quantity: 3, purchasePrice: null }),
      lot({ id: "ny", quantity: 1, purchasePrice: 40000 }),
    ]);
    expect(g.quantity).toBe(4);
    expect(g.costedQuantity).toBe(1);
    expect(g.averagePaid).toBe(40000);
    expect(g.totalPaid).toBe(40000);
  });

  it("ger null-snitt när INGET köp har ett pris — aldrig 0 kr", () => {
    const [g] = groupLots([lot({ id: "a" }), lot({ id: "b" })]);
    expect(g.quantity).toBe(2);
    expect(g.costedQuantity).toBe(0);
    expect(g.averagePaid).toBeNull();
    expect(g.totalPaid).toBeNull();
  });

  it("håller isär olika varor och behåller inkommande ordning", () => {
    const groups = groupLots([
      lot({ id: "a", cardId: "x" }),
      lot({ id: "b", cardId: "y" }),
      lot({ id: "c", cardId: "x" }),
    ]);
    expect(groups.map((g) => g.lots.map((l) => l.id))).toEqual([["a", "c"], ["b"]]);
  });

  it("0 kr räknas som ett pris och drar ner snittet", () => {
    const [g] = groupLots([
      lot({ id: "gratis", purchasePrice: 0 }),
      lot({ id: "köpt", purchasePrice: 20000 }),
    ]);
    expect(g.costedQuantity).toBe(2);
    expect(g.averagePaid).toBe(10000);
  });
});
