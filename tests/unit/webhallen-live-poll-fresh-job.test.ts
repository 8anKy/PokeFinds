import { describe, it, expect, vi } from "vitest";

// 2026-09-30/10-01: varje nytt loop-jobb i Discord-lanen startar med tom live-cache. Taket
// (16) tog 16 av 63 kandidater och resten fick sökindexets PREORDER — indexet saknar
// nivåkravet — så Delta Reign postades som "går nu att förhandsboka" en gång per jobb.

const future = Math.floor(Date.now() / 1000) + 30 * 86400;
const items = Array.from({ length: 20 }, (_, i) => ({
  id: 402550 + i,
  name: `Pokemon ME06 Delta Reign Booster ${i}`,
  price: { price: "79", currency: "SEK" },
  categoryTree: "Leksaker & Hobby/Samlarkortspel/Pokémon",
  release: { timestamp: future },
  stock: { web: 0, displayCap: 50 },
}));

let productApiDown = false;
vi.mock("@/scrapers/http", () => ({
  politeFetch: vi.fn(async (url: string) => {
    const m = url.match(/\/api\/product\/(\d+)/);
    if (m && productApiDown) return { ok: false, status: 503, json: async () => ({}) };
    const body = m
      ? { product: { ...items.find((it) => it.id === Number(m[1]))!, minimumRankLevel: 26 } }
      : url.includes("page=1&")
        ? { products: items }
        : { products: [] };
    return { ok: true, status: 200, json: async () => body };
  }),
}));
vi.mock("@/scrapers/adapters/webhallen-stores", () => ({
  fetchWebhallenStores: async () => new Map(),
  storeLabel: (s: { name: string }) => s.name,
}));

describe("Webhallen live-koll i ett nytt loop-jobb", () => {
  it("⛔ taket får aldrig lämna en OKOLLAD vara med indexets förhandsbokning", async () => {
    vi.stubEnv("WEBHALLEN_LIVE_POLL_MAX", "3");
    const { WebhallenAdapter } = await import("@/scrapers/adapters/webhallen-adapter");
    const { products } = await new WebhallenAdapter().fetchProducts();
    expect(products).toHaveLength(20);
    expect(products.filter((p) => p.stockStatus === "PREORDER")).toHaveLength(0);
    expect(products.filter((p) => p.stockUnconfirmed)).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("⛔ svarar inte produkt-API:t märks indexets förhandsbokning OBEKRÄFTAD", async () => {
    vi.resetModules(); // tom live-cache, som ett nytt jobb
    productApiDown = true;
    const { WebhallenAdapter } = await import("@/scrapers/adapters/webhallen-adapter");
    const { products } = await new WebhallenAdapter().fetchProducts();
    expect(products).toHaveLength(20);
    expect(products.every((p) => p.stockStatus === "PREORDER" && p.stockUnconfirmed === true)).toBe(true);
    productApiDown = false;
  });
});
