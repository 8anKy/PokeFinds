/**
 * NOLLPRISET FÅR INTE SLÄNGA ANNONSEN (2026-09-04).
 *
 * Butikerna prissätter OSLÄPPTA produkter till 0 kr som platshållare. ShopifyAdapter
 * gjorde `if (priceOre <= 0) return []` — så vi tappade inte priset utan HELA raden:
 * den nådde aldrig feeden, fick aldrig en StoreListing, importerades aldrig och kunde
 * aldrig larma. Det bet exakt på osläppta set, dvs precis det folk bevakar. MÄTT över
 * 8 Shopify-butiker: 26 av 2 268, alla 30th Celebration (Beam Cardshop 20, RGB Kingz 6).
 *
 * Testet låser BÅDA riktningarna: en 0 kr-annons överlever med `price === null`
 * ("pris okänt"), och null blir aldrig 0 — 0 kr är inget pris. Prissatta annonser
 * ska vara helt opåverkade, och ingen ANNAN adapter får plötsligt acceptera null
 * (matching-import.md: härda före vidgning — bara Shopify har det uppmätta problemet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockStatus } from "@prisma/client";

// politeFetch är den enda nätvägen i adaptern. Feeden här är formad exakt som Shopifys
// /products.json — det är `toRaws` (privat) som testas, via den publika fetchProducts.
const feed = vi.hoisted(() => ({ products: [] as unknown[] }));
vi.mock("@/scrapers/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/scrapers/http")>()),
  politeFetch: vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
}));

import { ShopifyAdapter } from "@/scrapers/adapters/shopify-adapter";
import { AlphaspelAdapter } from "@/scrapers/adapters/alphaspel-adapter";
import { FantasiaNorthAdapter } from "@/scrapers/adapters/woocommerce-adapter";
import { isPlaceholderListingPrice } from "@/lib/listing-plausibility";
import type { RawProductData } from "@/scrapers/types";

class TestShop extends ShopifyAdapter {
  name = "Testbutik";
  baseUrl = "https://testbutik.example";
  protected wholeCatalog = true; // en sida /products.json, ingen collections.json-runda
}

const variant = (id: number, price: string, available: boolean, title = "Default Title") => ({
  id,
  title,
  price,
  available,
});
const product = (id: number, title: string, variants: unknown[]) => ({
  id,
  title,
  handle: `handle-${id}`,
  variants,
});

const validRaw = (price: number | null): RawProductData => ({
  externalId: "testbutik-1",
  title: "Pokémon 30th Celebration Elite Trainer Box",
  url: "https://testbutik.example/products/x",
  price,
  currency: "SEK",
  stockStatus: StockStatus.OUT_OF_STOCK,
  raw: {},
});

describe("Shopify: 0 kr-platshållaren överlever som pris okänt", () => {
  const shop = new TestShop();
  beforeEach(() => {
    feed.products = [];
  });

  it("en osläppt produkt (0.00, ej köpbar) blir en annons med price=null, aldrig 0", async () => {
    feed.products = [
      product(1, "Pokémon 30th Celebration Elite Trainer Box", [variant(11, "0.00", false)]),
    ];
    const { products, errors } = await shop.fetchProducts();
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    const [p] = products;
    expect(p.price).toBeNull();
    expect(p.price).not.toBe(0);
    expect(p.stockStatus).toBe(StockStatus.OUT_OF_STOCK);
    expect(p.url).toBe("https://testbutik.example/products/handle-1");
    // Validerar — det är hela poängen: raden ska nå feeden.
    expect(shop.validateResult(p)).toBe(true);
    // …men ger ingen prisobservation: 0 kr är inget pris.
    expect(shop.extractPrice(p.raw)).toBeNull();
    // Normaliseringen bär null vidare oförändrat.
    expect(shop.normalizeProduct(p).price).toBeNull();
  });

  it("0 kr som ÄR köpbar behåller lagerstatusen — null säger inget om lagret", async () => {
    feed.products = [product(2, "Pokémon 30th Celebration Booster Bundle", [variant(21, "0.00", true)])];
    const [p] = (await shop.fetchProducts()).products;
    expect(p.price).toBeNull();
    expect(p.stockStatus).toBe(StockStatus.IN_STOCK);
  });

  it("oläsbart pris ⇒ null, raden överlever (samma regel, inte en egen väg)", async () => {
    feed.products = [product(3, "Pokémon 30th Celebration Booster Pack", [variant(31, "", false)])];
    const [p] = (await shop.fetchProducts()).products;
    expect(p.price).toBeNull();
    expect(shop.validateResult(p)).toBe(true);
  });

  it("en prissatt produkt är helt opåverkad", async () => {
    feed.products = [product(4, "Pokémon Prismatic Evolutions Elite Trainer Box", [variant(41, "599.00", true)])];
    const [p] = (await shop.fetchProducts()).products;
    expect(p.price).toBe(59900);
    expect(shop.validateResult(p)).toBe(true);
    expect(shop.extractPrice(p.raw)).toEqual({ price: 59900, currency: "SEK" });
    expect(shop.normalizeProduct(p).price).toBe(59900);
  });

  it("billigaste KÄNDA priset vinner — en 0 kr-variant får inte bli 'billigast'", async () => {
    feed.products = [
      product(5, "Pokémon Destined Rivals Booster Pack", [
        variant(51, "0.00", true, "Default Title"),
        variant(52, "59.00", true, "Default Title"),
      ]),
    ];
    const [p] = (await shop.fetchProducts()).products;
    expect(p.price).toBe(5900);
  });

  it("köpbara varianter utan känt pris ⇒ null, aldrig en slutsåld variants pris", async () => {
    feed.products = [
      product(6, "Pokémon Journey Together Booster Box", [
        variant(61, "0.00", true, "Default Title"),
        variant(62, "1899.00", false, "Default Title"),
      ]),
    ];
    const [p] = (await shop.fetchProducts()).products;
    expect(p.price).toBeNull();
    expect(p.stockStatus).toBe(StockStatus.IN_STOCK);
  });

  it("sortiment: varje variant är sin egen annons, och bara den prislösa blir null", async () => {
    feed.products = [
      product(7, "Pokemon Ascended Heroes ex Box", [
        variant(71, "0.00", false, "Mega Emboar"),
        variant(72, "449.00", true, "Mega Meganium"),
      ]),
    ];
    const { products } = await shop.fetchProducts();
    expect(products).toHaveLength(2);
    const byUrl = new Map(products.map((p) => [p.url, p]));
    expect(byUrl.get("https://testbutik.example/products/handle-7?variant=71")?.price).toBeNull();
    expect(byUrl.get("https://testbutik.example/products/handle-7?variant=72")?.price).toBe(44900);
    for (const p of products) expect(shop.validateResult(p)).toBe(true);
  });
});

describe("validateResult: null är godkänt, 0 och negativa TAL är det inte", () => {
  const shop = new TestShop();
  it("Shopify släpper igenom null men avvisar 0, negativa och icke-heltal", () => {
    expect(shop.validateResult(validRaw(null))).toBe(true);
    expect(shop.validateResult(validRaw(59900))).toBe(true);
    expect(shop.validateResult(validRaw(0))).toBe(false);
    expect(shop.validateResult(validRaw(-100))).toBe(false);
    expect(shop.validateResult(validRaw(12.5))).toBe(false);
  });

  it("övriga adaptrar kräver fortfarande ett positivt pris — null avvisas", () => {
    // Två plattformar som representanter: HTML-skrapad (Alphaspel) och Store-API (Woo).
    // Ingen av dem har ett uppmätt platshållarproblem; härda före vidgning.
    for (const adapter of [new AlphaspelAdapter(), new FantasiaNorthAdapter()]) {
      expect(adapter.validateResult(validRaw(null))).toBe(false);
      expect(adapter.validateResult(validRaw(0))).toBe(false);
      expect(adapter.validateResult(validRaw(59900))).toBe(true);
    }
  });

  it("null är ingen platshållare heller — vakten i runner/upsertListingOffer får inte fälla den", () => {
    expect(isPlaceholderListingPrice(null, "ETB")).toBe(false);
    expect(isPlaceholderListingPrice(null, null)).toBe(false);
  });
});
