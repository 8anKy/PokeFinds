import { describe, it, expect } from "vitest";
import { shopifyCartUrl, wooCartUrl, quickbutikCartUrl, nordiskCartUrl, nordiskCartForm, buyLink } from "../../src/lib/cart-url";
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

  it("Quickbutik: /cart/add?product_id=<pid>&qty=1 — probat Mystery Shack 2026-09-18 (302 → /cart/index)", () => {
    expect(quickbutikCartUrl("https://mysteryshack.se", "1326")).toBe("https://mysteryshack.se/cart/add?product_id=1326&qty=1");
    expect(quickbutikCartUrl("https://www.swepoke.se/", 8134)).toBe("https://www.swepoke.se/cart/add?product_id=8134&qty=1");
    expect(quickbutikCartUrl("https://mysteryshack.se", "")).toBeNull();
    expect(quickbutikCartUrl("https://mysteryshack.se", "12a")).toBeNull();
  });

  it("Nordisk e-handel: korgen tar bara POST ⇒ länken går via bryggan /api/go/korg", () => {
    expect(nordiskCartUrl("https://www.maxgaming.se", "41363")).toBe(
      "https://foilio.se/api/go/korg?shop=www.maxgaming.se&artnr=41363"
    );
    expect(nordiskCartUrl("https://www.spelexperten.com", "HABG7161681")).toBe(
      "https://foilio.se/api/go/korg?shop=www.spelexperten.com&artnr=HABG7161681"
    );
    // ⛔ .env:s http://localhost:3000 får ALDRIG in i prod-databasen (hände 2026-09-18) — bara https räknas
    expect(nordiskCartUrl("https://www.maxgaming.se", "1")).toMatch(/^https:\/\//);
    expect(nordiskCartUrl("https://www.maxgaming.se", undefined)).toBeNull();
    expect(nordiskCartUrl("https://www.maxgaming.se", "41363 or 1=1")).toBeNull();
    // ⛔ allowlist — en butik som inte är Nordisk e-handel får aldrig en bryggelänk
    expect(nordiskCartUrl("https://goblinen.com", "41363")).toBeNull();
    expect(nordiskCartUrl("not a url", "41363")).toBeNull();
  });

  it("nordiskCartForm: fälten browsern skickar (funk=laggtill, artnr, altnr=artnr, antal=1) — probat 2026-09-18", () => {
    expect(nordiskCartForm("www.maxgaming.se", "40749")).toEqual({
      action: "https://www.maxgaming.se/shop",
      shopName: "MaxGaming",
      fields: { funk: "laggtill", artnr: "40749", altnr: "40749", antal: "1" },
    });
    expect(nordiskCartForm("WWW.MAXGAMING.SE", "40749")?.action).toBe("https://www.maxgaming.se/shop");
    // ⛔ främmande host eller skräp-artnr ⇒ null ⇒ 400, aldrig ett formulär mot en okänd sajt
    expect(nordiskCartForm("evil.example", "1")).toBeNull();
    expect(nordiskCartForm("www.maxgaming.se", '"><script>')).toBeNull();
    expect(nordiskCartForm(null, null)).toBeNull();
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

describe("pushAlertUrl — användarens val (notificationSettings.pushTarget, 2026-09-17)", () => {
  const base = {
    type: "RESTOCK" as const,
    productSlug: "30th-celebration-elite-trainer-box",
    listingUrl: null,
    storeUrl: "https://goblinen.com/products/30th-celebration-etb",
    cartUrl: "https://goblinen.com/cart/add?id=1&quantity=1",
    toStore: true,
  };
  it("cart (default) ⇒ korgen; utan korglänk ⇒ butikens produktsida", () => {
    expect(pushAlertUrl({ ...base, target: "cart" })).toBe(base.cartUrl);
    expect(pushAlertUrl({ ...base })).toBe(base.cartUrl);
    expect(pushAlertUrl({ ...base, target: "cart", cartUrl: null })).toBe(base.storeUrl);
  });
  it("store ⇒ butikens produktsida även när korglänk finns", () => {
    expect(pushAlertUrl({ ...base, target: "store" })).toBe(base.storeUrl);
  });
  it("foilio ⇒ vår produktsida", () => {
    expect(pushAlertUrl({ ...base, target: "foilio" })).toBe("/produkter/30th-celebration-elite-trainer-box");
  });
  it("prislarm går till Foilio oavsett val", () => {
    expect(pushAlertUrl({ ...base, type: "PRICE_DROP", target: "cart" })).toBe("/produkter/30th-celebration-elite-trainer-box");
  });
});
