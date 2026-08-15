/**
 * purchasableFromShopifyPage — läser Shopify-storefrontens KÖPKNAPP.
 *
 * Finns för att Shopifys `available` inte betyder "går att köpa": Kortarkivets
 * "Ascended Heroes Booster Bundle (ME2.5)" svarade `available: true` i products.json,
 * i /products/{handle}.js OCH i sidans JSON-LD (`schema.org/InStock`), medan
 * storefronten visade "Slut i lager" och renderade knappen `disabled`. Alla tre
 * "definitiva" källorna kommer ur samma Liquid-fält och kan därför inte motsäga
 * varandra — bara knappen vet.
 *
 * ⛔ EGENSKAPEN SOM GÖR DETEKTORN ANVÄNDBAR ÖVERALLT: den håller med eller AVSTÅR.
 *    Mätt 2026-08-15 mot 20 Shopify-butikers riktiga produktsidor (tre i lager + tre
 *    slutsålda per butik): 0 fall där den felaktigt motsade feeden, 1 äkta träff, och
 *    4 butiker där den svarade null. Därför behövs ingen handhållen butikslista —
 *    `null` betyder "lita på feeden".
 */
import { describe, it, expect } from "vitest";
import { purchasableFromShopifyPage } from "@/scrapers/stock-verify";

/** Minimal återgivning av strukturen på en riktig Shopify-produktsida. */
function page(opts: {
  variantId?: number;
  disabled?: boolean;
  buttonText?: string;
  extraForms?: string;
}): string {
  const id = opts.variantId ?? 52909306151178;
  return `<!doctype html><html><body>
    ${opts.extraForms ?? ""}
    <form method="post" action="/cart/add" id="product-form-template__main" class="main-product-form">
      <input type="hidden" name="id" value="${id}" class="product-variant-id">
      <button id="ProductSubmitButton" type="submit" name="add"
        class="product-form__submit btn btn--primary"${opts.disabled ? "\n        disabled\n      " : ""}>
        <span class="btn__text">${opts.buttonText ?? "Lägg till i varukorg"}</span>
      </button>
    </form>
  </body></html>`;
}

describe("purchasableFromShopifyPage", () => {
  it("köpbar när knappen är aktiv", () => {
    expect(purchasableFromShopifyPage(page({}), null)).toBe(true);
  });

  it("EJ köpbar när knappen är disabled — Kortarkivet-fallet", () => {
    expect(purchasableFromShopifyPage(page({ disabled: true }), null)).toBe(false);
  });

  it("EJ köpbar när knapptexten säger slutsåld (tema som inte sätter disabled)", () => {
    for (const text of ["Slut i lager", "Sold out", "Udsolgt", "Ausverkauft", "Slutsåld"]) {
      expect(purchasableFromShopifyPage(page({ buttonText: text }), null), text).toBe(false);
    }
  });

  it("väljer formuläret med RÄTT variant-id när URL:en pekar ut en variant", () => {
    // Sortimentssidor har ett formulär per variant; att läsa fel ger fel vara.
    const html = page({
      variantId: 111,
      disabled: true,
      extraForms: `<form method="post" action="/cart/add" id="product-form-other">
        <input type="hidden" name="id" value="222">
        <button type="submit" name="add" class="product-form__submit">Lägg till i varukorg</button>
      </form>`,
    });
    expect(purchasableFromShopifyPage(html, 111)).toBe(false);
    expect(purchasableFromShopifyPage(html, 222)).toBe(true);
  });

  it("⛔ null när den efterfrågade varianten inte finns på sidan", () => {
    // Varianten borttagen ur butiken = vi vet inget om DEN varan, och får inte svara
    // för sidans andra variant.
    expect(purchasableFromShopifyPage(page({ variantId: 111 }), 999)).toBe(null);
  });

  it("⛔ null när sidan saknar köpformulär (JS-renderade teman)", () => {
    expect(purchasableFromShopifyPage("<html><body><h1>Produkt</h1></body></html>", null)).toBe(null);
  });

  it("⛔ null när flera formulär är lika trovärdiga och ingen variant pekats ut", () => {
    const html = `<form method="post" action="/cart/add"><input type="hidden" name="id" value="1">
        <button name="add">Köp</button></form>
      <form method="post" action="/cart/add"><input type="hidden" name="id" value="2">
        <button name="add">Köp</button></form>`;
    expect(purchasableFromShopifyPage(html, null)).toBe(null);
  });

  it("ignorerar avbetalningsformuläret och läser huvudformuläret", () => {
    // Riktiga sidor har ett `class="installment"`-formulär FÖRE huvudformuläret, utan
    // köpknapp. Det får inte göra svaret tvetydigt.
    const html = page({
      disabled: true,
      extraForms: `<form method="post" action="/cart/add" id="product-form-installment" class="installment">
        <input type="hidden" name="id" value="52909306151178">
      </form>`,
    });
    expect(purchasableFromShopifyPage(html, null)).toBe(false);
  });
});
