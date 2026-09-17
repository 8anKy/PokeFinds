import { describe, it, expect } from "vitest";
import { shopifyCartUrl, wooCartUrl, buyLink } from "../../src/lib/cart-url";
import { pushAlertUrl } from "../../src/lib/push-alert-url";

describe("cart-url — lägg-i-korgen-länkar (ägarbeslut 2026-09-17)", () => {
  it("Shopify: /cart/add?id=<variant>&quantity=1 — probat 27/27 butiker 2026-09-17", () => {
    expect(shopifyCartUrl("https://goblinen.com", 55235346891096)).toBe(
      "https://goblinen.com/cart/add?id=55235346891096&quantity=1"
    );
    expect(shopifyCartUrl("https://goblinen.com/", "123")).toBe("https://goblinen.com/cart/add?id=123&quantity=1");
    expect(shopifyCartUrl("https://goblinen.com", "abc")).toBeNull();
  });

  it("⛔ kvantiteten är alltid 1", () => {
    expect(shopifyCartUrl("https://x.se", 1)).toContain("quantity=1");
  });

  it("WooCommerce: bara enkla produkter får en länk", () => {
    expect(wooCartUrl("https://fantasianorth.se", 4711, "simple")).toBe("https://fantasianorth.se/?add-to-cart=4711");
    expect(wooCartUrl("https://fantasianorth.se", 4711, undefined)).toBe("https://fantasianorth.se/?add-to-cart=4711");
    expect(wooCartUrl("https://fantasianorth.se", 4711, "variable")).toBeNull();
  });

  it("buyLink: korgen när den finns, annars produktsidan", () => {
    expect(buyLink("https://x.se/cart/add?id=1&quantity=1", "https://x.se/products/p")).toBe(
      "https://x.se/cart/add?id=1&quantity=1"
    );
    expect(buyLink(null, "https://x.se/products/p")).toBe("https://x.se/products/p");
    expect(buyLink("", "https://x.se/products/p")).toBe("https://x.se/products/p");
  });
});

describe("pushAlertUrl — korgen före butikens produktsida", () => {
  const base = {
    productSlug: "30th-celebration-elite-trainer-box",
    listingUrl: null,
    storeUrl: "https://goblinen.com/products/30th-celebration-etb",
    toStore: true,
  };
  it("restock med korglänk ⇒ korgen", () => {
    expect(pushAlertUrl({ ...base, type: "RESTOCK", cartUrl: "https://goblinen.com/cart/add?id=1&quantity=1" })).toBe(
      "https://goblinen.com/cart/add?id=1&quantity=1"
    );
  });
  it("restock utan korglänk ⇒ butikens produktsida (som förut)", () => {
    expect(pushAlertUrl({ ...base, type: "RESTOCK", cartUrl: null })).toBe(base.storeUrl);
    expect(pushAlertUrl({ ...base, type: "NEW_LISTING" })).toBe(base.storeUrl);
  });
  it("prislarm går fortfarande till vår produktsida — där jämför man", () => {
    expect(pushAlertUrl({ ...base, type: "PRICE_DROP", cartUrl: "https://goblinen.com/cart/add?id=1&quantity=1" })).toBe(
      "/produkter/30th-celebration-elite-trainer-box"
    );
  });
});
