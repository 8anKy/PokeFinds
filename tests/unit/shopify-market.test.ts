import { describe, expect, it } from "vitest";
import { SE_MARKET_HEADERS, withSeMarket } from "@/scrapers/shopify-market";

// Rogerz (rogerz.dk) slutade lyssna på localization-cookien 2026-11-01 och svarade i DKK —
// `?country=SE` är det som pinnar svenska marknaden. Båda skickas på varje Shopify-hämtning.
describe("withSeMarket", () => {
  it("lägger på country=SE och behåller befintliga parametrar", () => {
    expect(withSeMarket("https://rogerz.dk/products.json?limit=250&page=2")).toBe(
      "https://rogerz.dk/products.json?limit=250&page=2&country=SE"
    );
    expect(withSeMarket("https://rogerz.dk/products/x.js")).toBe("https://rogerz.dk/products/x.js?country=SE");
    expect(withSeMarket("https://rogerz.dk/products/x?variant=123")).toBe(
      "https://rogerz.dk/products/x?variant=123&country=SE"
    );
  });
  it("skriver över en annan marknad i stället för att dubblera", () => {
    expect(withSeMarket("https://rogerz.dk/products/x.js?country=DK")).toBe("https://rogerz.dk/products/x.js?country=SE");
  });
  it("rör inte en ogiltig URL", () => {
    expect(withSeMarket("inte en url")).toBe("inte en url");
  });
  it("cookien finns kvar (Yonko TCG m.fl. lyssnar på den)", () => {
    expect(SE_MARKET_HEADERS.cookie).toBe("localization=SE");
  });
});
