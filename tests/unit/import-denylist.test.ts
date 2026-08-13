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

/**
 * NORMALISERINGEN AVGÖR HUR BRETT EN POST SLÅR (2026-08-13).
 *
 * `normUrl` strippade hela query-strängen. Två fel följde, båda upptäckta i drift:
 *
 *  1. `.../Products?idProduct=271864` blev `.../products`, så EN inlagd
 *     Cardmarket-URL nekade VARJE Cardmarket-produkt.
 *  2. Shopifys `?variant=` ÄR annonsens identitet — vår egen adapter delar en
 *     produktsida i en annons per variant. Utan variant i nyckeln nekade EN variant
 *     hela sidan, inklusive den variant som lagligen satt på den kanoniska
 *     produkten. 22 kanoniska vintage-produkter fick sin LEVANDE Rogerz-offer nekad,
 *     och `runner.ts` hoppar över nekade URL:er även när offern redan finns ⇒ priset
 *     hade frusit och offern dött.
 */
describe("normaliseringen: varianten är identitet, spårning är brus", () => {
  const ROGERZ = "https://rogerz.dk/products/pokemon-aquapolis-booster-pack";

  it("skiljer Shopify-varianter åt", () => {
    // Exakt en av Aquapolis-varianterna sitter på kanonprodukten och MÅSTE släppas
    // igenom; de övriga är nekade.
    expect(isDeniedListingUrl(`${ROGERZ}?variant=57143635411275`)).toBe(true);
    expect(isDeniedListingUrl(`${ROGERZ}?variant=47755235459403`)).toBe(false);
  });

  it("en nekad variant nekar INTE hela produktsidan", () => {
    expect(isDeniedListingUrl(ROGERZ)).toBe(false);
  });

  it("spårningsparametrar ändrar inte identiteten", () => {
    const denied = "https://goblinen.com/products/pokemon-tcg-mega-zygarde-ex-premium-collection";
    expect(isDeniedListingUrl(denied)).toBe(true);
    expect(isDeniedListingUrl(`${denied}?utm_source=nyhetsbrev`)).toBe(true);
    expect(isDeniedListingUrl(`${denied}#pris`)).toBe(true);
  });

  it("ingen post får neka en hel marknadsplats", () => {
    // Cardmarket lägger identiteten i queryn; en post därifrån hade blivit ett
    // blankettförbud. Tradera lägger den i sökvägen och är därför ofarlig.
    expect(isDeniedListingUrl("https://www.cardmarket.com/en/Pokemon/Products?idProduct=999999&language=1")).toBe(false);
    expect(isDeniedListingUrl("https://www.tradera.com/item/1001339/1/en-helt-annan-annons")).toBe(false);
    // …men den ENA avsiktliga Tradera-posten gäller fortfarande.
    expect(isDeniedListingUrl("https://www.tradera.com/item/1001341/742200148/pokemon-tcg-luminous-city-mini-tins")).toBe(true);
  });
});
