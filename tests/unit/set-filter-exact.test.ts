import { describe, expect, it, vi } from "vitest";

// buildProductWhere når prisma/cache-modulerna vid import — stubba dem.
vi.mock("@/lib/db", () => ({
  prisma: { cardSet: { findUnique: vi.fn() }, product: {}, $queryRawUnsafe: vi.fn() },
  withDbRetry: (fn: unknown) => fn,
}));
vi.mock("@/lib/cache", () => ({
  cachedRead: (fn: unknown) => fn,
  cachedReadTagged: (fn: unknown) => fn,
  singleFlight: (fn: unknown) => fn,
  productCacheTag: (slug: string) => `produkt:${slug}`,
  STATIC_CACHE_TAG: "statisk",
  PRICE_CACHE_TAG: "priser",
}));
vi.mock("@/services/market", () => ({ getTrendingLift: vi.fn() }));

const { buildProductWhere } = await import("@/services/products");

/**
 * Setfiltret får BARA matcha exakt: produktens eget set eller singelns korts set.
 * Titel-reserven ("normalizedTitle innehåller setnamnet") drog in 2382 produkter
 * i fel set — "Scarlet & Violet" fångade Destined Rivals-boostern, "Dragon" varje
 * Dragonair, "151" varje kort med nummer 151. Mätt mot prod 2026-07-27: den
 * bidrog med noll produkter som saknade eget set. Se services/products.ts.
 */
describe("setfiltret är exakt", () => {
  it("matchar bara på setId — aldrig på titeln", async () => {
    const where = await buildProductWhere({ setId: "set_sv" });
    const clauses = (where.AND as Record<string, unknown>[]) ?? [];
    const setClause = clauses.find((c) => "OR" in c) as { OR: Record<string, unknown>[] } | undefined;

    expect(setClause).toBeDefined();
    expect(setClause!.OR).toEqual([{ setId: { in: ["set_sv"] } }, { card: { setId: { in: ["set_sv"] } } }]);
    expect(JSON.stringify(where)).not.toContain("normalizedTitle");
  });

  it("flera set (2026-09-28) ⇒ produkten ligger i NÅGOT av dem, fortfarande bara på setId", async () => {
    const where = await buildProductWhere({ setId: ["set_sv", "set_151"] });
    const clauses = (where.AND as Record<string, unknown>[]) ?? [];
    const setClause = clauses.find((c) => "OR" in c) as { OR: Record<string, unknown>[] } | undefined;
    expect(setClause!.OR).toEqual([
      { setId: { in: ["set_sv", "set_151"] } },
      { card: { setId: { in: ["set_sv", "set_151"] } } },
    ]);
    expect(JSON.stringify(where)).not.toContain("normalizedTitle");
  });

  it("lägger inget set-villkor alls utan setId", async () => {
    const where = await buildProductWhere({});
    expect(JSON.stringify(where.AND ?? [])).not.toContain("setId");
  });
});
