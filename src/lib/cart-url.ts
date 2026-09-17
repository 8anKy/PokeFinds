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
 *   Quickbutik   `/cart/add?product_id=<pid>&qty=1` → 302 till /cart/index med varan i.
 *                Probat 2026-09-18 (Mystery Shack, cart/fetch bekräftade raden). `pid` =
 *                `data-pid` i kategoriblocket = `qs-cart-pid` på produktsidan. En produkt
 *                MED alternativ (Packs on Packs "Öppna live / Skicka sealed") studsar
 *                tillbaka till produktsidan med tom korg — dvs vår vanliga fallback, ofarligt.
 *   Nordisk e-handel (MaxGaming, Spelexperten — `AIR_ibutik`): korgen tar BARA POST
 *                (`/shop`, funk=laggtill + artnr + altnr + antal; ingen CSRF-token — probat
 *                2026-09-18 mot bådas cart-XML, GET gör ingenting). En länk kan inte POST:a,
 *                så `cartUrl` pekar på VÅR brygga `/api/go/korg?shop=<host>&artnr=<nr>`,
 *                som renderar ett självskickande formulär (`nordiskCartForm`). Öppnas som
 *                extern länk (systemwebbläsaren) — i WebView:en hade Capacitor tappat
 *                POST-kroppen. ⚠️ Butikens sessionskaka saknar SameSite ⇒ Chrome skickar
 *                inte en BEFINTLIG session på cross-site-POST (Lax+POST-undantaget gäller
 *                bara kakor < 2 min): butiken startar ny session, varan hamnar i korgen,
 *                men det användaren redan hade i MaxGamings korg är borta. Safari/iOS
 *                skickar kakan. Ägaren informerad 2026-09-18.
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

/** Quickbutik: en produkt i korgen. Produkter med alternativ studsar hos butiken (se ovan). */
export function quickbutikCartUrl(baseUrl: string, productId: number | string): string | null {
  const id = String(productId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `${baseUrl.replace(/\/+$/, "")}/cart/add?product_id=${id}&qty=1`;
}

/**
 * Nordisk e-handel-butiker som bryggan får POST:a till. ⛔ Allowlist, aldrig fri host —
 * annars är `/api/go/korg` en öppen omdirigerare/formulärkanon mot vilken sajt som helst.
 * Nyckel = värdnamnet exakt som butikens `baseUrl` bär det; värde = namnet i bryggans copy.
 */
export const NORDISK_CART_SHOPS: Readonly<Record<string, string>> = {
  "www.maxgaming.se": "MaxGaming",
  "www.spelexperten.com": "Spelexperten",
};

/** Artikelnummer hos Nordisk e-handel: siffror (MaxGaming) eller leverantörskod (Spelexperten "HABG7161681"). */
const NORDISK_ARTNR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** Appens absoluta bas — `||`, inte `??`: tom sträng är felläget (samma regel som canonical.ts). */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://foilio.se").replace(/\/+$/, "");

/**
 * Nordisk e-handel: länk till VÅR brygga, som POST:ar varan i butikens korg. `null` när
 * butiken inte står i allowlisten eller artikelnumret inte ser ut som ett.
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
  return `${APP_URL}/api/go/korg?shop=${encodeURIComponent(host)}&artnr=${encodeURIComponent(nr)}`;
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
