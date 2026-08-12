import { describe, expect, it, vi } from "vitest";

// buildProductWhere når prisma/cache-modulerna vid import — stubba dem.
vi.mock("@/lib/db", () => ({
  prisma: { cardSet: { findUnique: vi.fn() }, product: {}, $queryRawUnsafe: vi.fn() },
  withDbRetry: (fn: unknown) => fn,
}));
vi.mock("@/lib/cache", () => ({
  cachedRead: (fn: unknown) => fn,
  singleFlight: (fn: unknown) => fn,
}));
vi.mock("@/services/market", () => ({ getTrendingLift: vi.fn() }));

const { buildProductWhere } = await import("@/services/products");
const { PRINT_VARIANT_LABELS } = await import("@/lib/print-variant");

/** Synlighetsvillkoret ur AND-listan (det enda som nämner lowestPriceOre). */
function priceClause(where: Record<string, unknown>): string {
  const clauses = (where.AND as Record<string, unknown>[]) ?? [];
  const hit = clauses.filter((c) => JSON.stringify(c).includes("lowestPriceOre"));
  expect(hit).toHaveLength(1);
  return JSON.stringify(hit[0]);
}

/**
 * Prislösa tryckningar (Shadowless/1st Edition — de delar CM-produkt och får
 * därför medvetet ingen prisuppskattning) är UNDANTAGNA från "göm prislösa
 * produkter", annars hade en sökning på "charizard base" visat en av tre.
 *
 * Men Postgres sorterar NULL FÖRST i DESC, så "Högsta pris" inleddes med dem:
 * mätt i prod 2026-08-13 var det 56 produkter (41 Shadowless + 15 1st Edition)
 * av 31 063 — en förstasida med bara "–" där det dyraste skulle stå.
 * Prissorteringarna kräver därför ett pris; alla andra vyer behåller undantaget.
 */
describe("prissortering kräver ett pris", () => {
  it("prissorteringarna släpper undantaget för tryckningar", async () => {
    for (const sort of ["price_asc", "price_desc"] as const) {
      const clause = priceClause(await buildProductWhere({ sort }));
      expect(clause).toBe(JSON.stringify({ lowestPriceOre: { not: null } }));
      for (const label of PRINT_VARIANT_LABELS) expect(clause).not.toContain(label);
    }
  });

  it("behåller undantaget i alla andra vyer", async () => {
    // Inget sort = katalogens standard, och de sorteringar som INTE ordnar på
    // priset självt får inte tappa tryckningarna (de är kurerade katalogposter).
    for (const sort of [undefined, "best_match", "biggest_drop", "title_asc", "trending"] as const) {
      const clause = priceClause(await buildProductWhere({ sort }));
      expect(clause).toContain('"OR"');
      for (const label of PRINT_VARIANT_LABELS) expect(clause).toContain(label);
    }
  });
});
