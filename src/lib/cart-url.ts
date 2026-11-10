/**
 * LÄGG-I-VARUKORGEN-LÄNKAR (ägarbeslut 2026-09-17).
 *
 * Restock är ett lopp. Ett tryck på pushen/Discord-knappen/mejlets knapp ska lämna
 * användaren med varan REDAN I KORGEN, inte på en produktsida med en köpknapp kvar
 * att hitta. Bara butiker vars plattform exponerar en GET-länk för det kan få en:
 *
 *   Shopify      `/cart/add?id=<variant>&quantity=1&return_to=/checkout` → 302 till
 *                /checkout med varan i (BEFINTLIG korg behålls). Probat 2026-09-17 mot ALLA
 *                27 Shopify-butiker vi bevakar: 27/27 svarar 302 på /cart/add (ingen kö-/
 *                bot-app blockerar); `return_to=/checkout` verifierat i riktig Chrome
 *                2026-09-18 (Dragon's Lair 302 → /checkout, Goblinen landade i Shop Pay-
 *                kassan med varan). Ägarbeslut 2026-09-18: KASSAN, inte korgen — utan
 *                `return_to` stannade RahTech på /cart. ⛔ Inte cart-permalinken
 *                `/cart/<variant>:1` — den TÖMMER korgen och skickar via shop.app.
 *                Variant-id:t kommer ur feeden vi redan hämtar (products.json), aldrig ur
 *                URL-gissning.
 *   WooCommerce  `/?add-to-cart=<produkt-id>` för ENKLA produkter (variabla kräver
 *                variations-id som Store API v1 inte ger på listningen).
 *   Quickbutik   `/cart/add?product_id=<pid>&qty=1` → 302 till /cart/index → 302 vidare till
 *                checkout.quickbutik.com med varan i (verifierat i Chrome 2026-09-18, Mystery
 *                Shack). Probat 2026-09-18 (cart/fetch bekräftade raden). `pid` =
 *                `data-pid` i kategoriblocket = `qs-cart-pid` på produktsidan. En produkt
 *                MED alternativ (Packs on Packs "Öppna live / Skicka sealed") studsar
 *                tillbaka till produktsidan med tom korg — dvs vår vanliga fallback, ofarligt.
 *   Nordisk e-handel (MaxGaming, Spelexperten — `AIR_ibutik`): `/shop?funk=laggtill&artnr=X
 *                &altnr=X&antal=1` som vanlig GET-länk → butikens "Du har nu lagt i din
 *                varukorg"-sida med "Till kassan". ⛔ `altnr` KRÄVS — utan det gör butiken
 *                ingenting (därför trodde probet 2026-09-18 att bara POST fungerade, och
 *                länken gick via vår POST-brygga /api/go/korg). Omprobat 2026-11-10 mot bådas
 *                cart-XML: GET lägger varan i korgen. Direktlänken är snabbare (ingen omväg
 *                via oss) och, som toppnivå-GET, skickar den butikens BEFINTLIGA sessionskaka
 *                (Lax) ⇒ korgen användaren redan hade behålls i Chrome — bryggans POST
 *                tappade den. ⛔ Ingen parameter skickar vidare till kassan: butiken visar
 *                alltid bekräftelsesidan (probat 2026-11-10: nastasteg/funk2/retur gör inget).
 *                Bryggan (`nordiskCartForm` + rutten) står KVAR för länkar som redan skickats.
 *   Alla andra   ingen länk — POST med äkta CSRF (Alphaspel), JS-korg (Webhallen),
 *                butiksvara (SF-Bok). Pushen faller då tillbaka på produktsidan.
 *
 * ⛔ Länken hoppar över butikens produktsida och därmed "max N per kund"-texten.
 *    Ägaren är medveten och har godkänt det; ber en butik oss sluta faller vi tillbaka
 *    på produktsidan för den butiken (adaptern slutar sätta `cartUrl`).
 * ⛔ Kvantitet är ALLTID 1. En länk som lägger fler är en scalper-hjälp, inte ett larm.
 * ⛔ Ren modul — inga fetch, inga DB-anrop. Domen "kan den här offern få en korglänk"
 *    tas av adaptern som SER variant-id:t; hjälparna här formar bara URL:en.
 */

/** Shopify: en variant i korgen och vidare till kassan. `baseUrl` utan avslutande snedstreck. */
export function shopifyCartUrl(baseUrl: string, variantId: number | string): string | null {
  const id = String(variantId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `${baseUrl.replace(/\/+$/, "")}/cart/add?id=${id}&quantity=1&return_to=/checkout`;
}

/** WooCommerce: en enkel produkt i korgen (variabla produkter får ingen länk). */
export function wooCartUrl(baseUrl: string, productId: number | string, type?: string | null): string | null {
  const id = String(productId).trim();
  if (!/^\d+$/.test(id)) return null;
  if (type && type !== "simple") return null;
  return `${baseUrl.replace(/\/+$/, "")}/?add-to-cart=${id}`;
}

/** Quickbutik: en produkt i korgen. Produkter med alternativ studsar hos butiken (se ovan). */
export function quickbutikCartUrl(baseUrl: string, productId: number | string): string | null {
  const id = String(productId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `${baseUrl.replace(/\/+$/, "")}/cart/add?product_id=${id}&qty=1`;
}

/**
 * Nordisk e-handel-butiker som får korglänkar (direktlänken och den gamla bryggan). ⛔ Allowlist, aldrig fri host —
 * annars är `/api/go/korg` en öppen omdirigerare/formulärkanon mot vilken sajt som helst.
 * Nyckel = värdnamnet exakt som butikens `baseUrl` bär det; värde = namnet i bryggans copy.
 */
export const NORDISK_CART_SHOPS: Readonly<Record<string, string>> = {
  "www.maxgaming.se": "MaxGaming",
  "www.spelexperten.com": "Spelexperten",
};

/** Artikelnummer hos Nordisk e-handel: siffror (MaxGaming) eller leverantörskod (Spelexperten "HABG7161681"). */
const NORDISK_ARTNR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/**
 * Nordisk e-handel: direkt GET-länk som lägger varan i butikens korg. `null` när butiken
 * inte står i allowlisten eller artikelnumret inte ser ut som ett.
 */
export function nordiskCartUrl(baseUrl: string, artnr: string | null | undefined): string | null {
  const nr = (artnr ?? "").trim();
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return null;
  }
  if (!(host in NORDISK_CART_SHOPS) || !NORDISK_ARTNR.test(nr)) return null;
  const a = encodeURIComponent(nr);
  return `https://${host}/shop?funk=laggtill&artnr=${a}&altnr=${a}&antal=1`;
}

/**
 * Bryggans indata → vart formuläret ska POST:a. Ren och testad; rutten bara renderar.
 * `null` = ogiltig/okänd ⇒ rutten svarar 400, aldrig ett formulär mot en främmande host.
 */
export function nordiskCartForm(shop: string | null, artnr: string | null): {
  action: string;
  shopName: string;
  fields: Record<string, string>;
} | null {
  const host = (shop ?? "").trim().toLowerCase();
  const nr = (artnr ?? "").trim();
  const shopName = NORDISK_CART_SHOPS[host];
  if (!shopName || !NORDISK_ARTNR.test(nr)) return null;
  // Fälten browsern själv skickar (formuläret `AIR_ibutik_laggtill`), minus artgrp som
  // visade sig onödigt; `altnr` = artnr KRÄVS — utan det svarar butiken med produktsidan
  // och tom korg. ⛔ antal alltid "1".
  return { action: `https://${host}/shop`, shopName, fields: { funk: "laggtill", artnr: nr, altnr: nr, antal: "1" } };
}

/**
 * Vart ett larm ska leda: korgen när butiken har en korglänk, annars produktsidan.
 * Tomma strängar räknas som saknade.
 */
export function buyLink(cartUrl: string | null | undefined, storeUrl: string): string {
  return cartUrl && cartUrl.length > 0 ? cartUrl : storeUrl;
}
