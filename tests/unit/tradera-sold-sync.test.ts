import { describe, expect, it } from "vitest";
import { salesByItemId } from "@/jobs/tradera-sold-sync";

describe("salesByItemId", () => {
  it("mappar objekt-id → försäljningspris (kr→öre) och datum, hoppar tomma", () => {
    const map = salesByItemId([
      { item: { id: 738838205 }, amount: 399, date: "2026-07-01T10:00:00" },
      { item: { id: 738837238 }, amount: 120, date: "2026-06-30T09:00:00" },
      { item: {}, amount: 50 },
      {},
    ]);
    expect(map.size).toBe(2);
    expect(map.get("738838205")?.salePriceOre).toBe(39900);
    expect(map.get("738838205")?.soldAt.toISOString()).toBe(new Date("2026-07-01T10:00:00").toISOString());
    expect(map.get("738837238")?.salePriceOre).toBe(12000);
  });
});
