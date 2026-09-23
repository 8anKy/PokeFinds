import { describe, it, expect, vi } from "vitest";

// Live-kollen (/api/product/{id}) hittar påfyllningen ~50 min före sökindexet. Den
// 2026-09-23 postades 30th Celebrations BUTIKSpåfyllning som en online-restock: bara
// statusen skrevs om ur live-svaret, `storeOnly`/`storeStock` stod kvar från indexets "slut".

const searchItem = {
  id: 401990,
  name: "Pokemon 30th Celebration 2-Pack Blister",
  price: { price: "129", currency: "SEK" },
  categoryTree: "Leksaker & Hobby/Samlarkortspel/Pokémon",
  release: { timestamp: Math.floor(Date.now() / 1000) - 7 * 86400 },
  stock: { web: 0, displayCap: 50, "31": 0, "32": 0 },
};
const liveProduct = { ...searchItem, stock: { web: 0, displayCap: 50, "31": 4, "32": 9 } };

vi.mock("@/scrapers/http", () => ({
  politeFetch: vi.fn(async (url: string) => {
    const body = url.includes("/api/product/")
      ? { product: liveProduct }
      : url.includes("page=1&")
        ? { products: [searchItem] }
        : { products: [] };
    return { ok: true, status: 200, json: async () => body };
  }),
}));
vi.mock("@/scrapers/adapters/webhallen-stores", () => ({
  fetchWebhallenStores: async () =>
    new Map([
      [31, { id: 31, name: "Bredden (InfraCity)", city: "Upplands Väsby" }],
      [32, { id: 32, name: "Ringen", city: "Stockholm" }],
    ]),
  storeLabel: (s: { name: string; city: string | null }) => (s.city ? `${s.name}, ${s.city}` : s.name),
}));

describe("Webhallen live-koll", () => {
  it("⛔ en butikspåfyllning ur live-svaret blir en BUTIKSVARA med saldo — inte en online-restock", async () => {
    const { WebhallenAdapter } = await import("@/scrapers/adapters/webhallen-adapter");
    const { products } = await new WebhallenAdapter().fetchProducts();
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.stockStatus).toBe("IN_STOCK");
    expect(p.storeOnly).toBe(true);
    expect(p.storeStock?.units).toBe(13);
    expect(p.storeStock?.stores).toBe(2);
    expect(p.storeStock?.locations?.[0]).toMatchObject({ label: "Ringen, Stockholm", units: 9 });
  });
});
