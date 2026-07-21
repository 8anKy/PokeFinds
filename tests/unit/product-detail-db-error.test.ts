/**
 * Regressionsvakt: ett DB-fel får ALDRIG bli "produkten finns inte".
 *
 * Bakgrund (2026-07-21): `loadProductDetailRaw` gjorde `.catch(() => null)` runt
 * produktuppslaget. Ett anslutningsfel (P1017 när Neon vaknar ur scale-to-zero)
 * blev då null → produktsidan kallade `notFound()` → ISR CACHADE 404:an i en
 * timme. Symtom: en produkt man precis öppnat 404:ar slumpvis och kommer sedan
 * tillbaka av sig själv. Ett äkta "finns inte" ska däremot fortfarande ge null.
 */
import { describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

// Pass-through: vi testar funktionslogiken, inte Next-cachen.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

vi.mock("@/lib/db", () => ({
  prisma: { product: { findUnique: (...a: unknown[]) => findUnique(...a) } },
  withDbRetry: (fn: () => Promise<unknown>) => fn(), // ingen väntan i testet
}));

vi.mock("@/services/market", () => ({ getTrendingLift: async () => new Map() }));

const { loadProductDetail } = await import("@/services/products");

describe("loadProductDetail vid DB-fel", () => {
  it("kastar vidare ett anslutningsfel (blir aldrig ett cachat 404)", async () => {
    const err = Object.assign(new Error("Server has closed the connection"), {
      code: "P1017",
    });
    findUnique.mockImplementation(() => Promise.reject(err));

    let caught: unknown = null;
    let result: unknown = "aldrig-anropad";
    try {
      result = await loadProductDetail("nagon-produkt");
    } catch (e) {
      caught = e;
    }
    expect(result).toBe("aldrig-anropad"); // fick INTE returnera null
    expect((caught as { code?: string } | null)?.code).toBe("P1017");
  });

  it("ger null när produkten faktiskt inte finns", async () => {
    findUnique.mockImplementation(() => Promise.resolve(null));
    await expect(loadProductDetail("finns-inte")).resolves.toBeNull();
  });
});
