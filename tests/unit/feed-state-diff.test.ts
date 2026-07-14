import { describe, it, expect } from "vitest";
import { buildStateMap, actionableChanges, type FeedGroup } from "@/lib/feed-state-diff";

const g = (sourceName: string, items: [string, string][]): FeedGroup => ({
  sourceName,
  items: items.map(([url, stockStatus]) => ({ url, stockStatus: stockStatus as any })),
});
const NONE = new Set<string>();

describe("feed-state-diff — väcker Neon BARA på riktiga lagerflippar", () => {
  it("oförändrat lager → inga förändringar (Neon får sova)", () => {
    const prev = buildStateMap([g("DL", [["a", "IN_STOCK"], ["b", "OUT_OF_STOCK"]])]);
    const cur = [g("DL", [["a", "IN_STOCK"], ["b", "OUT_OF_STOCK"]])];
    expect(actionableChanges(prev, cur, NONE)).toHaveLength(0);
  });

  it("OUT_OF_STOCK → IN_STOCK = restock → väck", () => {
    const prev = buildStateMap([g("DL", [["a", "OUT_OF_STOCK"]])]);
    const changes = actionableChanges(prev, [g("DL", [["a", "IN_STOCK"]])], NONE);
    expect(changes).toEqual([{ key: "DL\ta", from: "OUT_OF_STOCK", to: "IN_STOCK", reason: "restock" }]);
  });

  it("IN_STOCK → OUT_OF_STOCK = sellout → väck ÄNDÅ (DB måste veta, annars missas nästa restock)", () => {
    const prev = buildStateMap([g("DL", [["a", "IN_STOCK"]])]);
    const changes = actionableChanges(prev, [g("DL", [["a", "OUT_OF_STOCK"]])], NONE);
    expect(changes).toEqual([{ key: "DL\ta", from: "IN_STOCK", to: "OUT_OF_STOCK", reason: "sellout" }]);
  });

  it("UNKNOWN räknas ALDRIG (speglar isRealStockTransition)", () => {
    const prev = buildStateMap([g("DL", [["a", "UNKNOWN"], ["b", "IN_STOCK"]])]);
    const cur = [g("DL", [["a", "IN_STOCK"], ["b", "UNKNOWN"]])];
    expect(actionableChanges(prev, cur, NONE)).toHaveLength(0);
  });
});

describe("feed-state-diff — roterande butiker väcker inte på URL-churn", () => {
  it("roterande butik som byter URL-DELMÄNGD (ingen lagerflipp) → sover", () => {
    // Swepoke roterar: förra körningen visade a,b — nu visar c,d. Rent rotationsbrus.
    const prev = buildStateMap([g("Swepoke", [["a", "IN_STOCK"], ["b", "IN_STOCK"]])]);
    const cur = [g("Swepoke", [["c", "IN_STOCK"], ["d", "IN_STOCK"]])];
    const rotating = new Set(["Swepoke"]);
    expect(actionableChanges(prev, cur, rotating)).toHaveLength(0);
  });

  it("men en RIKTIG lagerflipp på en roterande butiks kvarvarande URL väcker ändå", () => {
    const prev = buildStateMap([g("Swepoke", [["a", "OUT_OF_STOCK"], ["b", "IN_STOCK"]])]);
    const cur = [g("Swepoke", [["a", "IN_STOCK"], ["c", "IN_STOCK"]])];
    const changes = actionableChanges(prev, cur, new Set(["Swepoke"]));
    // a: OOS→IN = restock (väck). c: ny URL på roterande = rotation (ignorera). b: borta = ignorera.
    expect(changes).toEqual([{ key: "Swepoke\ta", from: "OUT_OF_STOCK", to: "IN_STOCK", reason: "restock" }]);
  });

  it("ny URL i lager: ICKE-roterande = möjlig ny produkt (väck); roterande = brus (sov)", () => {
    const prev: Record<string, string> = {};
    const cur = [g("DL", [["new1", "IN_STOCK"]]), g("Swepoke", [["new2", "IN_STOCK"]])];
    const changes = actionableChanges(prev, cur, new Set(["Swepoke"]));
    expect(changes).toEqual([{ key: "DL\tnew1", from: "ABSENT", to: "IN_STOCK", reason: "ny-i-lager" }]);
  });

  it("ny URL som är OUT_OF_STOCK väcker aldrig (inget att larma om)", () => {
    const changes = actionableChanges({}, [g("DL", [["x", "OUT_OF_STOCK"]])], NONE);
    expect(changes).toHaveLength(0);
  });
});

describe("buildStateMap — IN_STOCK vinner när en URL dyker upp flera gånger", () => {
  it("samma url OOS + IN i samma feed → IN_STOCK (som DB-fasens `fresh`)", () => {
    const m = buildStateMap([g("DL", [["a", "OUT_OF_STOCK"], ["a", "IN_STOCK"]])]);
    expect(m["DL\ta"]).toBe("IN_STOCK");
  });
});
