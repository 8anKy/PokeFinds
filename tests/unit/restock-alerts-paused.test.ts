/**
 * Vaktar pausen av restock-larmen (src/lib/restock-alerts-pause.ts).
 *
 * Regressionen som gav testet: `gh workflow disable restock-watch.yml` 2026-08-23
 * stängde bara SNABBFILEN. Nattens `scrape-all` → `runScrapeJob` anropar samma
 * `checkRestockAlerts`, så mejl och push fortsatte gå ut en gång per dygn — 8 mejl
 * 2026-08-25 — medan pause-mejlet påstod motsatsen för användarna.
 *
 * Testet assertar att INGEN DB-fråga görs i pausat läge: grinden måste ligga före
 * produktuppslaget, annars kostar den Neon-tid i varje varv av nattkedjan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const productFindUnique = vi.fn();
const watchlistFindMany = vi.fn();
const userFindMany = vi.fn();
const alertCreate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findUnique: (...a: unknown[]) => productFindUnique(...a) },
    watchlistItem: { findMany: (...a: unknown[]) => watchlistFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    setWatch: { findMany: vi.fn().mockResolvedValue([]) },
    alert: { create: (...a: unknown[]) => alertCreate(...a), findFirst: vi.fn().mockResolvedValue(null) },
    restockEvent: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

import { checkListingAlerts, checkPriceAlerts, checkRestockAlerts } from "@/services/alerts";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";

const PRODUCT = { id: "p1", title: "Pitch Black Elite Trainer Box", slug: "pitch-black-etb", setId: "s1", category: "SEALED", set: { name: "Pitch Black" } };

beforeEach(() => {
  productFindUnique.mockReset().mockResolvedValue(PRODUCT);
  watchlistFindMany.mockReset().mockResolvedValue([{ userId: "u1" }]);
  userFindMany.mockReset().mockResolvedValue([{ id: "u2" }]);
  alertCreate.mockReset().mockImplementation((args: unknown) => args);
  transaction.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  process.env.RESTOCK_ALERTS_PAUSED = "0"; // vitest.config.ts-läget
});

describe("restockAlertsPaused", () => {
  it("är PÅ som standard — en oimplementerad/glömd variabel ska pausa, inte larma", () => {
    delete process.env.RESTOCK_ALERTS_PAUSED;
    expect(restockAlertsPaused()).toBe(true);
    process.env.RESTOCK_ALERTS_PAUSED = "1";
    expect(restockAlertsPaused()).toBe(true);
    process.env.RESTOCK_ALERTS_PAUSED = "0";
    expect(restockAlertsPaused()).toBe(false);
  });
});

describe("pausat läge", () => {
  beforeEach(() => {
    process.env.RESTOCK_ALERTS_PAUSED = "1";
  });

  it("checkRestockAlerts skapar inga larm och rör inte databasen", async () => {
    const r = await checkRestockAlerts("p1", "r1", { from: "OUT_OF_STOCK", to: "IN_STOCK" });
    expect(r).toEqual({ triggered: 0 });
    expect(productFindUnique).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("checkListingAlerts är tyst för alla tre bespeden (feed-först-vägen)", async () => {
    for (const kind of ["NEW_LISTING", "RESTOCK", "PREORDER"] as const) {
      const r = await checkListingAlerts({ id: "l1", title: "Destined Rivals Booster Bundle", retailerId: "r1", productId: "p1" }, kind);
      expect(r).toEqual({ triggered: 0 });
    }
    expect(alertCreate).not.toHaveBeenCalled();
  });

  it("PRISLARM är INTE pausade — det är en egen funktion", async () => {
    productFindUnique.mockResolvedValue({ id: "p1", title: PRODUCT.title, slug: PRODUCT.slug });
    watchlistFindMany.mockResolvedValue([{ userId: "u1", targetPrice: 90000 }]);
    const r = await checkPriceAlerts("p1", 89000);
    expect(r).toEqual({ triggered: 1 });
    expect(alertCreate).toHaveBeenCalledTimes(1);
  });
});

describe("påslaget läge", () => {
  it("checkRestockAlerts larmar som vanligt när variabeln är 0", async () => {
    process.env.RESTOCK_ALERTS_PAUSED = "0";
    const r = await checkRestockAlerts("p1", undefined, { from: "OUT_OF_STOCK", to: "IN_STOCK" });
    expect(r.triggered).toBeGreaterThan(0);
    expect(productFindUnique).toHaveBeenCalled();
  });
});
