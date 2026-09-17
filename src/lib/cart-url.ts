/**
 * LÄGG-I-VARUKORGEN-LÄNKAR (ägarbeslut 2026-09-17).
 *
 * Restock är ett lopp. Ett tryck på pushen/Discord-knappen/mejlets knapp ska lämna
 * användaren med varan REDAN I KORGEN, inte på en produktsida med en köpknapp kvar
 * att hitta. Bara butiker vars plattform exponerar en GET-länk för det kan få en:
 *
 *   Shopify      `/cart/add?id=<variant>&quantity=1` → 302 till /cart med varan i.
 *                Probat 2026-09-17 mot ALLA 27 Shopify-butiker vi bevakar: 27/27 svarar
 *                302 → /cart (ingen kö-/bot-app blockerar). Variant-id:t kommer ur
 *                feeden vi redan hämtar (products.json), aldrig ur URL-gissning.
 *   WooCommerce  `/?add-to-cart=<produkt-id>` för ENKLA produkter (variabla kräver
 *                variations-id som Store API v1 inte ger på listningen).
 *   Alla andra   ingen länk — POST med CSRF (Alphaspel, Quickbutik), JS-korg (Webhallen,
 *                Swepoke), butiksvara (SF-Bok). Pushen faller då tillbaka på produktsidan.
 *
 * ⛔ Länken hoppar över butikens produktsida och därmed "max N per kund"-texten.
 *    Ägaren är medveten och har godkänt det; ber en butik oss sluta faller vi tillbaka
 *    på produktsidan för den butiken (adaptern slutar sätta `cartUrl`).
 * ⛔ Kvantitet är ALLTID 1. En länk som lägger fler är en scalper-hjälp, inte ett larm.
 * ⛔ Ren modul — inga fetch, inga DB-anrop. Domen "kan den här offern få en korglänk"
 *    tas av adaptern som SER variant-id:t; hjälparna här formar bara URL:en.
 */

/** Shopify: en variant i korgen. `baseUrl` utan avslutande snedstreck. */
export function shopifyCartUrl(baseUrl: string, variantId: number | string): string | null {
  const id = String(variantId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `${baseUrl.replace(/\/+$/, "")}/cart/add?id=${id}&quantity=1`;
}

/** WooCommerce: en enkel produkt i korgen (variabla produkter får ingen länk). */
export function wooCartUrl(baseUrl: string, productId: number | string, type?: string | null): string | null {
  const id = String(productId).trim();
  if (!/^\d+$/.test(id)) return null;
  if (type && type !== "simple") return null;
  return `${baseUrl.replace(/\/+$/, "")}/?add-to-cart=${id}`;
}

/**
 * Vart ett larm ska leda: korgen när butiken har en korglänk, annars produktsidan.
 * Tomma strängar räknas som saknade.
 */
export function buyLink(cartUrl: string | null | undefined, storeUrl: string): string {
  return cartUrl && cartUrl.length > 0 ? cartUrl : storeUrl;
}
