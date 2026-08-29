import { describe, expect, it, vi } from "vitest";

// buildProductWhere når prisma/cache-modulerna vid import — stubba dem.
vi.mock("@/lib/db", () => ({
  prisma: { cardSet: { findUnique: vi.fn() }, product: {}, $queryRawUnsafe: vi.fn() },
  withDbRetry: (fn: unknown) => fn,
}));
vi.mock("@/lib/cache", () => ({
  cachedRead: (fn: unknown) => fn,
  singleFlight: (fn: unknown) => fn,
  STATIC_CACHE_TAG: "statisk",
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
    expect(setClause!.OR).toEqual([{ setId: "set_sv" }, { card: { setId: "set_sv" } }]);
    expect(JSON.stringify(where)).not.toContain("normalizedTitle");
  });

  it("lägger inget set-villkor alls utan setId", async () => {
    const where = await buildProductWhere({});
    expect(JSON.stringify(where.AND ?? [])).not.toContain("setId");
  });
});
