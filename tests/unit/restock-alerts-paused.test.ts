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
  // vitest.config.ts-läget: båda larmen PÅ, så resten av sviten testar beteendet när
  // funktionerna faktiskt kör.
  process.env.RESTOCK_ALERTS_PAUSED = "0";
  process.env.PRICE_ALERTS_PAUSED = "0";
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

  it("rör INTE prislarmen — de har en egen flagga", async () => {
    // ⛔ TVÅ OBEROENDE SPAKAR, INTE EN. Prislarmen pausades också (2026-08-26), men av
    // helt andra skäl: restock väntar på KOSTNAD, prislarmen på en LAGNING. De slås på
    // igen vid olika tillfällen, och den här assertionen är det som gör det möjligt —
    // faller den har någon slagit ihop flaggorna och den ena funktionen kan inte längre
    // återvända utan den andra.
    process.env.PRICE_ALERTS_PAUSED = "0";
    productFindUnique.mockResolvedValue({ id: "p1", title: PRODUCT.title, slug: PRODUCT.slug });
    watchlistFindMany.mockResolvedValue([{ userId: "u1", targetPrice: 90000 }]);
    const r = await checkPriceAlerts("p1", 89000);
    expect(r).toEqual({ triggered: 1 });
    expect(alertCreate).toHaveBeenCalledTimes(1);
  });

  it("och åt andra hållet: pausade prislarm rör inte restock-larmen", async () => {
    process.env.RESTOCK_ALERTS_PAUSED = "0";
    process.env.PRICE_ALERTS_PAUSED = "1";
    const r = await checkRestockAlerts("p1", undefined, { from: "OUT_OF_STOCK", to: "IN_STOCK" });
    expect(r.triggered).toBeGreaterThan(0);
    // ...och prislarmet är tyst i samma läge, utan att ha rört databasen.
    productFindUnique.mockClear();
    const p = await checkPriceAlerts("p1", 89000);
    expect(p).toEqual({ triggered: 0 });
    expect(productFindUnique).not.toHaveBeenCalled();
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
