import { describe, expect, it } from "vitest";
import { classifyPriceMismatch, priceFromJsonLd, priceFromShopifyJs, samePrice } from "@/scrapers/store-price-audit";

const ld = (...nodes: object[]) =>
  nodes.map((n) => `<script type="application/ld+json">${JSON.stringify(n)}</script>`).join("");

describe("priceFromShopifyJs", () => {
  it("läser variantens pris när URL:en pekar ut en", () => {
    expect(priceFromShopifyJs({ variants: [{ id: 1, price: 39900 }, { id: 2, price: 49900 }] }, 2)).toBe(49900);
  });
  it("flera varianter med olika pris utan variant-id är tvetydigt", () => {
    expect(priceFromShopifyJs({ variants: [{ id: 1, price: 39900 }, { id: 2, price: 49900 }] }, null)).toBe("ambiguous");
  });
  it("en variant ⇒ dess pris", () => {
    expect(priceFromShopifyJs({ price: 59900, variants: [{ id: 1, price: 59900 }] }, null)).toBe(59900);
  });
  it("varianten borta ⇒ null", () => {
    expect(priceFromShopifyJs({ variants: [{ id: 1, price: 100 }] }, 9)).toBeNull();
  });
});

describe("priceFromJsonLd", () => {
  it("kronor → öre", () => {
    expect(priceFromJsonLd(ld({ "@type": "Product", offers: { price: "3299.00", priceCurrency: "SEK" } }))).toEqual({
      priceOre: 329900,
      currency: "SEK",
    });
  });
  it("decimalkomma", () => {
    expect(priceFromJsonLd(ld({ "@type": "Product", offers: { price: "1249,50", priceCurrency: "SEK" } }))).toEqual({
      priceOre: 124950,
      currency: "SEK",
    });
  });
  it("olika priser på sidan ⇒ tvetydigt", () => {
    expect(
      priceFromJsonLd(ld({ "@type": "Product", offers: { price: 100 } }, { "@type": "Product", offers: { price: 200 } }))
    ).toBe("ambiguous");
  });
});

describe("classifyPriceMismatch", () => {
  const live = (priceOre: number | null, extra: object = {}) => ({ priceOre, currency: "SEK", via: "json-ld" as const, ...extra });
  it("samma pris inom 1 kr/1 %", () => {
    expect(samePrice(329900, 329950)).toBe(true);
    expect(classifyPriceMismatch(329900, live(329900), false)).toBe("OK");
  });
  it("Webhallen 30th UPC: 5 999 hos oss, 3 299 live, sedd igår ⇒ fel", () => {
    expect(classifyPriceMismatch(599900, live(329900), false)).toBe("FRESH_MISMATCH");
    expect(classifyPriceMismatch(599900, live(329900), true)).toBe("STALE");
  });
  it("momsfaktorn känns igen åt båda håll", () => {
    expect(classifyPriceMismatch(63920, live(79900), false)).toBe("EX_VAT");
    expect(classifyPriceMismatch(99875, live(79900), false)).toBe("INC_VAT");
  });
  it("borta / okänt / annan valuta", () => {
    expect(classifyPriceMismatch(100, live(null, { note: "gone" }), false)).toBe("GONE");
    expect(classifyPriceMismatch(100, null, false)).toBe("UNKNOWN");
    expect(classifyPriceMismatch(100, { priceOre: 100, currency: "EUR", via: "json-ld" }, false)).toBe("CURRENCY");
  });
});
