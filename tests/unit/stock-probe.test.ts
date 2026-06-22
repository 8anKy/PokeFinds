/**
 * Tester för probeTarget (URL→probe-mappning i src/scrapers/stock-probe.ts).
 * Ren funktion, inget nätverk: verifierar att Shopify/Webhallen-offer-URL:er
 * mappas till rätt lager-endpoint och att okända mönster ger null (hoppas över).
 */
import { describe, expect, it } from "vitest";
import { probeTarget } from "@/scrapers/stock-probe";

describe("probeTarget", () => {
  it("mappar Webhallen-produkt till /api/product/{id}", () => {
    expect(probeTarget("https://www.webhallen.com/se/product/398336")).toEqual({
      kind: "webhallen",
      fetchUrl: "https://www.webhallen.com/api/product/398336",
    });
  });

  it("mappar Shopify-produkt till {origin}{path}.json", () => {
    expect(probeTarget("https://speltrollet.se/products/chaos-rising-etb")).toEqual({
      kind: "shopify",
      fetchUrl: "https://speltrollet.se/products/chaos-rising-etb.json",
    });
  });

  it("ignorerar query-strängen på Shopify-URL:er", () => {
    expect(probeTarget("https://shop.example/products/x?variant=42")?.fetchUrl).toBe(
      "https://shop.example/products/x.json"
    );
  });

  it("ger null för marknadsplatser/okända mönster", () => {
    expect(probeTarget("https://www.cardmarket.com/en/Pokemon/Products/Singles/x")).toBeNull();
    expect(probeTarget("https://www.tradera.com/item/123")).toBeNull();
    expect(probeTarget("inte-en-url")).toBeNull();
  });
});
