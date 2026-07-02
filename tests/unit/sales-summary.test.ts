import { describe, expect, it } from "vitest";
import { salesSummary, type SaleRow } from "@/services/sales";

function sale(salePriceOre: number, purchasePriceOre: number | null): SaleRow {
  return {
    id: Math.random().toString(),
    name: "x",
    setName: null,
    imageUrl: null,
    condition: "NEAR_MINT",
    language: "EN",
    purchasePriceOre,
    salePriceOre,
    soldAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("salesSummary", () => {
  it("summerar sålt, resultat (endast känt inköp), procent och bästa affär", () => {
    const s = salesSummary([
      sale(40000, 25000), // +15000
      sale(12000, 10000), // +2000
      sale(5000, null), // ingår i sålt totalt men ej i resultat/kostnad
    ]);
    expect(s.count).toBe(3);
    expect(s.totalSaleOre).toBe(57000);
    expect(s.totalCostOre).toBe(35000);
    expect(s.resultOre).toBe(17000);
    expect(s.resultPercent).toBeCloseTo((17000 / 35000) * 100);
    expect(s.bestResultOre).toBe(15000);
  });

  it("resultPercent är null när inget inköpspris finns", () => {
    const s = salesSummary([sale(5000, null)]);
    expect(s.resultPercent).toBeNull();
    expect(s.bestResultOre).toBeNull();
    expect(s.totalSaleOre).toBe(5000);
  });
});
