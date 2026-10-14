import { describe, it, expect, vi } from "vitest";

// 2026-10-14: Webhallen svarade 503/504. Sida 2 KASTADE efter politeFetch-omförsöken, och
// live-fasen låg i samma try ⇒ sida 1:s annonser behöll sökindexets PREORDER (indexet saknar
// nivålåset) och Discord postade "går nu att förhandsboka" för Delta Reign igen.

const future = Math.floor(Date.now() / 1000) + 30 * 86400;
const items = Array.from({ length: 6 }, (_, i) => ({
  id: 402557 + i,
  name: `Pokemon ME06 Delta Reign Booster ${i}`,
  price: { price: "79", currency: "SEK" },
  categoryTree: "Leksaker & Hobby/Samlarkortspel/Pokémon",
  release: { timestamp: future },
  stock: { web: 0, displayCap: 50 },
}));

let productApiThrows = false;
vi.mock("@/scrapers/http", () => ({
  politeFetch: vi.fn(async (url: string) => {
    const m = url.match(/\/api\/product\/(\d+)/);
    if (m) {
      if (productApiThrows) throw new Error("HTTP 503 från www.webhallen.com");
      const product = { ...items.find((it) => it.id === Number(m[1]))!, minimumRankLevel: 26 };
      return { ok: true, status: 200, json: async () => ({ product }) };
    }
    if (url.includes("page=1&")) return { ok: true, status: 200, json: async () => ({ products: items }) };
    throw new Error("HTTP 504 från www.webhallen.com");
  }),
}));
vi.mock("@/scrapers/adapters/webhallen-stores", () => ({
  fetchWebhallenStores: async () => new Map(),
  storeLabel: (s: { name: string }) => s.name,
}));

describe("Webhallen: avklippt feed (sidhämtningen kastar)", () => {
  it("⛔ live-kollen körs ändå — nivålåset vinner över indexets PREORDER", async () => {
    const { WebhallenAdapter } = await import("@/scrapers/adapters/webhallen-adapter");
    const { products, errors } = await new WebhallenAdapter().fetchProducts();
    expect(errors.length).toBeGreaterThan(0);
    expect(products).toHaveLength(6);
    expect(products.filter((p) => p.stockStatus === "PREORDER")).toHaveLength(0);
  });

  it("⛔ kastar även produkt-API:t märks varje PREORDER obekräftad", async () => {
    vi.resetModules();
    productApiThrows = true;
    const { WebhallenAdapter } = await import("@/scrapers/adapters/webhallen-adapter");
    const { products } = await new WebhallenAdapter().fetchProducts();
    expect(products).toHaveLength(6);
    expect(products.every((p) => p.stockStatus !== "PREORDER" || p.stockUnconfirmed === true)).toBe(true);
    expect(products.some((p) => p.stockStatus === "PREORDER")).toBe(true);
    productApiThrows = false;
  });
});
