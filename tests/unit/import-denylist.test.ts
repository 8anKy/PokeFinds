import { describe, it, expect } from "vitest";
import { isDeniedListingUrl } from "../../src/scrapers/import-denylist";

// Denylist gör ägarens borttagningar PERMANENTA: nekade URL:er blir aldrig produkter igen.
describe("isDeniedListingUrl", () => {
  it("nekar borttagna tillbehörs-/sortiments-URL:er", () => {
    expect(isDeniedListingUrl("https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster")).toBe(true);
    expect(isDeniedListingUrl("https://samlarhobby.se/products/pokemon-sun-moon-guardians-rising-1-blister-pack")).toBe(true);
    expect(isDeniedListingUrl("https://www.webhallen.com/se/product/396737")).toBe(true);
  });
  it("matchar trots avslutande slash / query / versaler (normalisering)", () => {
    expect(isDeniedListingUrl("https://www.maxgaming.se/sv/pokemon/pokemon-mega-evolution-checklane-booster/")).toBe(true);
    expect(isDeniedListingUrl("https://www.webhallen.com/se/product/396737?ref=x")).toBe(true);
    expect(isDeniedListingUrl("HTTPS://WWW.WEBHALLEN.COM/se/product/396737")).toBe(true);
  });
  it("släpper igenom vanliga produkt-URL:er", () => {
    expect(isDeniedListingUrl("https://dragonslair.se/products/pokemon-tcg-team-rocket-tin-mewtwo-pokemon")).toBe(false);
    expect(isDeniedListingUrl("https://www.webhallen.com/se/product/399539")).toBe(false);
  });
});
