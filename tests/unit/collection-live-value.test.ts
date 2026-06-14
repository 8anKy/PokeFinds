/**
 * Tester för valueCollectionItems — live Cardmarket-trendvärdering med
 * snapshot-fallback. Produkt-/korttjänsterna mockas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCardValues = vi.fn();
const getProductValues = vi.fn();

vi.mock("@/services/products", () => ({
  getCardValues: (...args: unknown[]) => getCardValues(...args),
  getProductValues: (...args: unknown[]) => getProductValues(...args),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { valueCollectionItems } from "@/services/collection";

beforeEach(() => {
  getCardValues.mockReset();
  getProductValues.mockReset();
});

describe("valueCollectionItems", () => {
  it("använder live kortvärde framför lagrat estimatedValue", async () => {
    getCardValues.mockResolvedValue(new Map([["c1", 12345]]));
    getProductValues.mockResolvedValue(new Map());

    const map = await valueCollectionItems([
      { id: "i1", cardId: "c1", productId: null, estimatedValue: 999 },
    ]);

    expect(map.get("i1")).toBe(12345);
  });

  it("använder live produktvärde för sealed-objekt", async () => {
    getCardValues.mockResolvedValue(new Map());
    getProductValues.mockResolvedValue(new Map([["p1", 209900]]));

    const map = await valueCollectionItems([
      { id: "i1", cardId: null, productId: "p1", estimatedValue: null },
    ]);

    expect(map.get("i1")).toBe(209900);
  });

  it("faller tillbaka på estimatedValue när live-data saknas", async () => {
    getCardValues.mockResolvedValue(new Map());
    getProductValues.mockResolvedValue(new Map());

    const map = await valueCollectionItems([
      { id: "i1", cardId: "c1", productId: null, estimatedValue: 5000 },
    ]);

    expect(map.get("i1")).toBe(5000);
  });

  it("utelämnar objekt helt utan känt värde", async () => {
    getCardValues.mockResolvedValue(new Map());
    getProductValues.mockResolvedValue(new Map());

    const map = await valueCollectionItems([
      { id: "i1", cardId: null, productId: null, estimatedValue: null },
    ]);

    expect(map.has("i1")).toBe(false);
  });
});
