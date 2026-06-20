/**
 * Tester för computeCollectionValue i src/services/collection.ts.
 * Prisma mockas med stubdata — vi verifierar den rena matematiken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    collectionItem: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

import { computeCollectionValue } from "@/services/collection";

interface StubItem {
  id: string;
  quantity: number;
  estimatedValue: number | null;
  purchasePrice: number | null;
  purchaseDate: Date | null;
  createdAt: Date;
  card: { name: string } | null;
  product: { title: string } | null;
}

function item(overrides: Partial<StubItem>): StubItem {
  return {
    id: Math.random().toString(36).slice(2),
    quantity: 1,
    estimatedValue: null,
    purchasePrice: null,
    purchaseDate: null,
    createdAt: new Date("2025-01-15"),
    card: null,
    product: null,
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
});

describe("computeCollectionValue", () => {
  it("summerar värde, kostnad och vinst (med kvantitet)", async () => {
    findMany.mockResolvedValue([
      // 2 st à 500 kr värde, köpta för 400 kr/st
      item({ quantity: 2, estimatedValue: 50000, purchasePrice: 40000 }),
      // 1 st à 100 kr värde, köpt för 200 kr
      item({ quantity: 1, estimatedValue: 10000, purchasePrice: 20000 }),
    ]);

    const result = await computeCollectionValue("user-1");

    expect(result.totalValue).toBe(2 * 50000 + 10000); // 110 000 öre
    expect(result.totalCost).toBe(2 * 40000 + 20000); // 100 000 öre
    expect(result.profit).toBe(10000);
    expect(result.profitPercent).toBe(10);
    expect(result.itemCount).toBe(3);
    expect(result.uniqueItems).toBe(2);
  });

  it("profitPercent är null när kostnad saknas (ingen division med noll)", async () => {
    findMany.mockResolvedValue([item({ estimatedValue: 50000 })]);

    const result = await computeCollectionValue("user-1");

    expect(result.totalCost).toBe(0);
    expect(result.profit).toBe(50000);
    expect(result.profitPercent).toBeNull();
  });

  it("ignorerar objekt utan estimatedValue i totalValue men räknar deras kostnad", async () => {
    findMany.mockResolvedValue([
      item({ estimatedValue: null, purchasePrice: 30000 }),
      item({ estimatedValue: 45000, purchasePrice: null }),
    ]);

    const result = await computeCollectionValue("user-1");

    expect(result.totalValue).toBe(45000);
    expect(result.totalCost).toBe(30000);
    expect(result.profit).toBe(15000);
    expect(result.profitPercent).toBe(50);
  });

  it("avrundar profitPercent till två decimaler", async () => {
    findMany.mockResolvedValue([
      item({ estimatedValue: 10000, purchasePrice: 30000 }), // -66,666...%
    ]);

    const result = await computeCollectionValue("user-1");
    expect(result.profitPercent).toBe(-66.67);
  });

  it("returnerar tom struktur för tom samling", async () => {
    findMany.mockResolvedValue([]);

    const result = await computeCollectionValue("user-1");

    expect(result.itemCount).toBe(0);
    expect(result.uniqueItems).toBe(0);
    expect(result.totalValue).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.profit).toBe(0);
    expect(result.profitPercent).toBeNull();
    expect(result.topItems).toEqual([]);
    expect(result.valueOverTime).toEqual([]);
  });

  it("topItems sorteras på totalvärde (värde × kvantitet) och begränsas till 5", async () => {
    findMany.mockResolvedValue([
      item({ card: { name: "A" }, estimatedValue: 10000, quantity: 1 }),
      item({ card: { name: "B" }, estimatedValue: 5000, quantity: 10 }), // 50 000
      item({ card: { name: "C" }, estimatedValue: 30000, quantity: 1 }),
      item({ card: { name: "D" }, estimatedValue: 1000, quantity: 1 }),
      item({ card: { name: "E" }, estimatedValue: 2000, quantity: 1 }),
      item({ card: { name: "F" }, estimatedValue: 1500, quantity: 1 }),
      item({ card: { name: "Utan värde" }, estimatedValue: null }),
    ]);

    const result = await computeCollectionValue("user-1");

    expect(result.topItems).toHaveLength(5);
    expect(result.topItems[0].name).toBe("B");
    expect(result.topItems[0].totalValue).toBe(50000);
    expect(result.topItems[1].name).toBe("C");
    expect(result.topItems.map((t) => t.name)).not.toContain("Utan värde");
  });

  it("valueOverTime ackumulerar värde per inköpsdag (daglig serie)", async () => {
    findMany.mockResolvedValue([
      item({ estimatedValue: 10000, purchaseDate: new Date("2025-01-10") }),
      item({ estimatedValue: 20000, purchaseDate: new Date("2025-01-20") }),
      item({ estimatedValue: 5000, purchaseDate: new Date("2025-03-05") }),
    ]);

    const result = await computeCollectionValue("user-1");
    const byDate = Object.fromEntries(result.valueOverTime.map((p) => [p.date, p.value]));

    // Serien börjar på första inköpsdagen och har en punkt per dag fram till idag.
    expect(result.valueOverTime[0].date).toBe("2025-01-10");
    expect(byDate["2025-01-10"]).toBe(10000); // bara objekt 1 ägs
    expect(byDate["2025-01-19"]).toBe(10000);
    expect(byDate["2025-01-20"]).toBe(30000); // objekt 2 tillkommer
    expect(byDate["2025-03-04"]).toBe(30000);
    expect(byDate["2025-03-05"]).toBe(35000); // objekt 3 tillkommer
    // Utan prishistorik är värdet platt på slutvärdet ända till idag.
    expect(result.valueOverTime[result.valueOverTime.length - 1].value).toBe(35000);
  });

  it("använder produkttitel som namn när kort saknas", async () => {
    findMany.mockResolvedValue([
      item({ product: { title: "Booster Box" }, estimatedValue: 100000 }),
    ]);

    const result = await computeCollectionValue("user-1");
    expect(result.topItems[0].name).toBe("Booster Box");
  });
});
