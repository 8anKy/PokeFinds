/**
 * verifyStockForUrl: en BORTTAGEN sida (404/410) är slutsåld, inte "okänd" (2026-09-20).
 *
 * Goblinen avpublicerade 30th Celebration-ETB:n efter släppet; URL:en är bevakad
 * (de återanvänder den vid nästa drop). Med 404 ⇒ null föll raden till UNKNOWN
 * ("Okänd" bredvid ett fyra dagar gammalt pris) — och UNKNOWN→IN_STOCK larmar
 * aldrig, så nästa drop hade varit tyst. 404 ⇒ OUT_OF_STOCK ger sanningen nu OCH ett
 * riktigt OUT→IN-larm när sidan kommer tillbaka.
 *
 * ⛔ Bara 404/410. 429/5xx/timeout är fortfarande "vet inte" — ett strypt svar får
 * aldrig bli en lagerstatus (INGET SVAR ≠ NY KUNSKAP).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockStatus } from "@prisma/client";

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock("@/scrapers/http", () => ({
  politeFetch: (url: string) => fetchMock(url),
}));

import { verifyStockForUrl } from "@/scrapers/stock-verify";

const resp = (status: number, body = "", type = "text/html", url?: string) => {
  const r = new Response(body, { status, headers: { "content-type": type } });
  // Node sätter `url` på ett riktigt fetch-svar (sista hoppet); Response() lämnar den tom.
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
};
const ld = (availability: string) =>
  `<html><script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "ETB",
    offers: { "@type": "Offer", price: "899", priceCurrency: "SEK", availability },
  })}</script></html>`;

beforeEach(() => fetchMock.mockReset());

describe("verifyStockForUrl — borttagen sida", () => {
  const goblinen = "https://goblinen.com/products/pokemon-tcg-30th-celebration-elite-trainer-box-max-1-kund";

  it("Shopify: .js 404 OCH sidan 404 ⇒ OUT_OF_STOCK", async () => {
    fetchMock.mockResolvedValueOnce(resp(404)).mockResolvedValueOnce(resp(404));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBe(StockStatus.OUT_OF_STOCK);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\.js$/);
  });

  it("Shopify: .js 404 och sidan 302:ar till STARTSIDAN (Goblinen/Beam, mätt 09-20) ⇒ OUT_OF_STOCK", async () => {
    fetchMock
      .mockResolvedValueOnce(resp(404))
      .mockResolvedValueOnce(resp(200, "<html>startsidan, 230 kB, inga Product-noder</html>", "text/html", "https://www.goblinen.com/"));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("Shopify: .js 404 och sidan omdirigerad till en kategorisida ⇒ OUT (läs aldrig fel sidas JSON-LD)", async () => {
    fetchMock
      .mockResolvedValueOnce(resp(404))
      .mockResolvedValueOnce(resp(200, ld("InStock"), "text/html", "https://goblinen.com/collections/pokemon"));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it("ett hopp som BEHÅLLER slug:en (apex→www, språkprefix) är inte 'borta' — sidans svar gäller", async () => {
    fetchMock
      .mockResolvedValueOnce(resp(404))
      .mockResolvedValueOnce(resp(200, ld("OutOfStock"), "text/html", "https://www.mysteryshack.se/sv/products/etb/"));
    expect(await verifyStockForUrl("Mystery Shack", "https://mysteryshack.se/products/etb")).toBe(
      StockStatus.OUT_OF_STOCK
    );
    fetchMock
      .mockResolvedValueOnce(resp(404))
      .mockResolvedValueOnce(resp(200, ld("InStock"), "text/html", "https://www.mysteryshack.se/products/etb"));
    expect(await verifyStockForUrl("Mystery Shack", "https://mysteryshack.se/products/etb")).toBe(
      StockStatus.IN_STOCK
    );
  });

  it("Shopify: .js 404 men sidan finns med JSON-LD ⇒ sidans svar (Quickbutik på /products/-form)", async () => {
    fetchMock.mockResolvedValueOnce(resp(404)).mockResolvedValueOnce(resp(200, ld("InStock")));
    expect(await verifyStockForUrl("Mystery Shack", "https://mysteryshack.se/products/etb")).toBe(
      StockStatus.IN_STOCK
    );
  });

  it("Shopify: .js 404 och sidan 200 UTAN JSON-LD ⇒ null (ingen gissning)", async () => {
    fetchMock.mockResolvedValueOnce(resp(404)).mockResolvedValueOnce(resp(200, "<html>Slut</html>"));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBeNull();
  });

  it("Shopify: 429/5xx (politeFetch kastar efter backoff) ⇒ null, aldrig slutsåld", async () => {
    fetchMock.mockRejectedValueOnce(new Error("HTTP 429 från goblinen.com"));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBeNull();
  });

  it("Shopify: .js 404 och sidan 403 (bot-vägg) ⇒ null", async () => {
    fetchMock.mockResolvedValueOnce(resp(404)).mockResolvedValueOnce(resp(403));
    expect(await verifyStockForUrl("Goblinen", goblinen)).toBeNull();
  });

  it("JSON-LD-butik: sidan 404 ⇒ OUT_OF_STOCK, 410 likaså", async () => {
    fetchMock.mockResolvedValueOnce(resp(404));
    expect(await verifyStockForUrl("Alphaspel", "https://www.alphaspel.se/1762-pokemon-tcg/1-x")).toBe(
      StockStatus.OUT_OF_STOCK
    );
    fetchMock.mockResolvedValueOnce(resp(410));
    expect(await verifyStockForUrl("Alphaspel", "https://www.alphaspel.se/1762-pokemon-tcg/1-x")).toBe(
      StockStatus.OUT_OF_STOCK
    );
  });

  it("Webhallen: API 404 ⇒ OUT_OF_STOCK, API 500 ⇒ null", async () => {
    fetchMock.mockResolvedValueOnce(resp(404, "{}", "application/json"));
    expect(await verifyStockForUrl("Webhallen", "https://www.webhallen.com/se/product/402000")).toBe(
      StockStatus.OUT_OF_STOCK
    );
    fetchMock.mockResolvedValueOnce(resp(500, "{}", "application/json"));
    expect(await verifyStockForUrl("Webhallen", "https://www.webhallen.com/se/product/402000")).toBeNull();
  });
});
