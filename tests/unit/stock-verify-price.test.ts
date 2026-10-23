/**
 * verifyListingForUrl: verify-passet läser PRISET ur samma svar som lagerdomen (2026-10-23).
 * Förr rättades bara lagret på en offer som fallit ur feeden, och priset frös på dagen
 * offern sågs sist (Pokexclusives 30th ETB: 2 499 kr i 29 dygn mot butikens 2 099).
 * Ett tvetydigt eller utländskt pris ⇒ null (skrivs aldrig).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockStatus } from "@prisma/client";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock("@/scrapers/http", () => ({
  politeFetch: (url: string) => fetchMock(url),
}));

import { verifyListingForUrl } from "@/scrapers/stock-verify";

const resp = (status: number, body = "", type = "text/html") =>
  new Response(body, { status, headers: { "content-type": type } });
const ld = (...offers: object[]) =>
  `<html>${offers
    .map((o) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "ETB", offers: o })}</script>`)
    .join("")}</html>`;

beforeEach(() => fetchMock.mockReset());

describe("verifyListingForUrl — priset ur samma svar", () => {
  it("Webhallen: price.price ur produkt-API:t (30th UPC 3 299 kr)", async () => {
    fetchMock.mockResolvedValueOnce(
      resp(
        200,
        JSON.stringify({ product: { price: { price: "3299.00", currency: "SEK" }, stock: { web: 0 }, release: null } }),
        "application/json"
      )
    );
    const t = await verifyListingForUrl("Webhallen", "https://www.webhallen.com/se/product/401987");
    expect(t.priceOre).toBe(329900);
  });

  it("Shopify .js: variantens pris i öre", async () => {
    fetchMock.mockResolvedValueOnce(
      resp(200, JSON.stringify({ available: false, variants: [{ id: 7, available: false, price: 209900 }] }), "application/json")
    );
    const t = await verifyListingForUrl("Pokexclusive", "https://pokexclusive.se/products/30th-etb");
    expect(t).toEqual({ status: StockStatus.OUT_OF_STOCK, priceOre: 209900 });
  });

  it("JSON-LD: pris + lager", async () => {
    fetchMock.mockResolvedValueOnce(resp(200, ld({ price: "349.00", priceCurrency: "SEK", availability: "InStock" })));
    const t = await verifyListingForUrl("Alphaspel", "https://alphaspel.se/1234-etb.html");
    expect(t).toEqual({ status: StockStatus.IN_STOCK, priceOre: 34900 });
  });

  it("annan valuta eller olika priser på sidan ⇒ inget pris", async () => {
    fetchMock.mockResolvedValueOnce(resp(200, ld({ price: "49.99", priceCurrency: "EUR", availability: "InStock" })));
    expect((await verifyListingForUrl("Alphaspel", "https://alphaspel.se/1-a.html")).priceOre).toBeNull();
    fetchMock.mockResolvedValueOnce(
      resp(200, ld({ price: "100", availability: "InStock" }, { price: "200", availability: "InStock" }))
    );
    expect((await verifyListingForUrl("Alphaspel", "https://alphaspel.se/2-b.html")).priceOre).toBeNull();
  });

  it("borta sida ⇒ OUT utan pris (gammalt pris står kvar)", async () => {
    fetchMock.mockResolvedValueOnce(resp(404));
    expect(await verifyListingForUrl("Alphaspel", "https://alphaspel.se/3-c.html")).toEqual({
      status: StockStatus.OUT_OF_STOCK,
      priceOre: null,
    });
  });
});
