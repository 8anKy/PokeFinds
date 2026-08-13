import { describe, it, expect, afterEach} from "vitest";
import { isDeniedListingUrl, setDynamicDenylist } from "../../src/scrapers/import-denylist";

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

/**
 * ADMINS EGEN DENYLISTA (2026-08-14) — "Ta bort" ska betyda borta.
 *
 * Källfilen kan inte skrivas av en körande container, så admin-borttagningen kunde
 * bara radera offer-raden. URL:en låg kvar i butikens feed och nästa skrapning
 * återskapade den — mätt: ägaren tog bort två länkar på Base Set Booster och båda
 * fanns igen inom en minut. Dynamiska poster kommer nu ur `DeniedListingUrl`.
 *
 * ⛔ MODULEN RÖR ALDRIG DATABASEN SJÄLV: `isDeniedListingUrl` anropas en gång per
 *    annons i loopar med tusentals varv. Anroparen (runner.ts) hämtar raderna EN gång
 *    per körning och matar in dem här.
 */
describe("dynamisk denylista (admins borttagningar)", () => {
  afterEach(() => setDynamicDenylist([]));

  it("nekar en URL som lagts till dynamiskt", () => {
    const u = "https://exempelbutik.se/products/nagot-som-inte-ska-finnas";
    expect(isDeniedListingUrl(u)).toBe(false);
    setDynamicDenylist([u]);
    expect(isDeniedListingUrl(u)).toBe(true);
  });

  it("normaliserar indata — en rå URL med spårning matchar ändå", () => {
    setDynamicDenylist(["https://Exempelbutik.se/products/VARA?utm_source=mail"]);
    expect(isDeniedListingUrl("https://exempelbutik.se/products/vara")).toBe(true);
    expect(isDeniedListingUrl("https://exempelbutik.se/products/vara#pris")).toBe(true);
  });

  it("behåller variant-precisionen även dynamiskt", () => {
    const bas = "https://butik.se/products/x";
    setDynamicDenylist([`${bas}?variant=111`]);
    expect(isDeniedListingUrl(`${bas}?variant=111`)).toBe(true);
    expect(isDeniedListingUrl(`${bas}?variant=222`)).toBe(false);
    expect(isDeniedListingUrl(bas)).toBe(false);
  });

  it("ersätter listan vid varje laddning — gamla poster hänger inte kvar", () => {
    setDynamicDenylist(["https://butik.se/products/a"]);
    setDynamicDenylist(["https://butik.se/products/b"]);
    expect(isDeniedListingUrl("https://butik.se/products/a")).toBe(false);
    expect(isDeniedListingUrl("https://butik.se/products/b")).toBe(true);
  });

  it("den KODGRANSKADE listan gäller oavsett dynamisk laddning", () => {
    setDynamicDenylist([]);
    expect(isDeniedListingUrl("https://goblinen.com/products/pokemon-tcg-mega-zygarde-ex-premium-collection")).toBe(true);
  });
});
