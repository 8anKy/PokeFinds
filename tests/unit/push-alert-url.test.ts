import { describe, expect, it } from "vitest";
import { pushAlertUrl } from "@/lib/push-alert-url";

const store = "https://www.goblinen.com/products/mega-evolution-etb";

describe("pushAlertUrl — restock-pushen leder till butiken, prislarm till produktsidan", () => {
  it("RESTOCK på katalogprodukt med direkt butikslänk → butiken (när grinden är öppen)", () => {
    expect(pushAlertUrl({ type: "RESTOCK", productSlug: "me-etb", listingUrl: null, storeUrl: store, toStore: true })).toBe(store);
    expect(pushAlertUrl({ type: "NEW_LISTING", productSlug: "me-etb", listingUrl: null, storeUrl: store, toStore: true })).toBe(store);
  });
  it("grinden stängd → produktsidan, som förut", () => {
    expect(pushAlertUrl({ type: "RESTOCK", productSlug: "me-etb", listingUrl: null, storeUrl: store, toStore: false })).toBe("/produkter/me-etb");
  });
  it("prislarm går ALLTID till produktsidan — poängen är att jämföra", () => {
    for (const type of ["PRICE_DROP", "PRICE_TARGET", "TREND", "SYSTEM"] as const) {
      expect(pushAlertUrl({ type, productSlug: "me-etb", listingUrl: null, storeUrl: store, toStore: true })).toBe("/produkter/me-etb");
    }
  });
  it("sök-/kategorilänk är ingen butikslänk → produktsidan", () => {
    expect(pushAlertUrl({ type: "RESTOCK", productSlug: "me-etb", listingUrl: null, storeUrl: "https://www.goblinen.com/search?q=etb", toStore: true })).toBe("/produkter/me-etb");
    expect(pushAlertUrl({ type: "RESTOCK", productSlug: "me-etb", listingUrl: null, storeUrl: null, toStore: true })).toBe("/produkter/me-etb");
  });
  it("feed-först-larm (ingen produkt) → annonsen, oavsett grind", () => {
    expect(pushAlertUrl({ type: "NEW_LISTING", productSlug: null, listingUrl: store, storeUrl: null, toStore: false })).toBe(store);
    expect(pushAlertUrl({ type: "NEW_LISTING", productSlug: null, listingUrl: null, storeUrl: null, toStore: true })).toBeUndefined();
  });
});
