/**
 * Butikens pris JUST NU för en offer-URL — revisionsverktyget `scripts/audit-store-prices.ts`
 * och prisreparationen (`scripts/repair-stale-store-prices.ts`) läser samma väg.
 *
 * Samma vägar som lagerverifieringen (stock-verify.ts): Shopifys `/products/{handle}.js`
 * (pris i öre, per variant), Webhallens produkt-API och annars sidans JSON-LD. Ett TVETYDIGT
 * svar (flera Product-noder med olika pris, flervariant utan `?variant=`) ⇒ null — aldrig en
 * gissning; en revision som påstår ett fel den inte kan bevisa är värre än ingen.
 */
import { collectProductNodes, parseJsonLdBlocks, shopifyHandleFromUrl, variantIdFromUrl, webhallenIdFromUrl } from "./gtin-source";

export interface LivePrice {
  priceOre: number | null;
  currency: string;
  /** "gone" = 404/410 eller omdirigerad bort; "ambiguous" = flera olika priser på sidan. */
  note?: "gone" | "ambiguous" | "no-price";
  via: "shopify-js" | "webhallen-api" | "json-ld";
}

type Fetcher = (url: string, opts?: { delayMs?: number; headers?: Record<string, string> }) => Promise<Response>;

const SHOPIFY_HEADERS = { cookie: "localization=SE", "accept-language": "sv-SE" };

/** Shopify `.js`: `price` i öre (minsta enhet). Pekar URL:en ut en variant gäller den. */
export function priceFromShopifyJs(
  data: { price?: number; variants?: { id?: number; price?: number }[] },
  wantedVariantId: number | null
): number | null | "ambiguous" {
  const variants = data.variants ?? [];
  if (wantedVariantId !== null) {
    const v = variants.find((x) => x.id === wantedVariantId);
    return typeof v?.price === "number" ? v.price : null;
  }
  const prices = [...new Set(variants.map((v) => v.price).filter((p): p is number => typeof p === "number"))];
  if (prices.length > 1) return "ambiguous";
  if (prices.length === 1) return prices[0];
  return typeof data.price === "number" ? data.price : null;
}

/** Pris ur JSON-LD (`offers.price` / `lowPrice`), kronor → öre. Olika priser ⇒ tvetydigt. */
export function priceFromJsonLd(html: string): { priceOre: number | null; currency: string } | "ambiguous" {
  const found = new Map<number, string>();
  for (const block of parseJsonLdBlocks(html)) {
    for (const product of collectProductNodes(block)) {
      const offers = product.offers;
      for (const offer of Array.isArray(offers) ? offers : [offers]) {
        if (!offer || typeof offer !== "object") continue;
        const o = offer as Record<string, unknown>;
        const raw = o.price ?? o.lowPrice;
        const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw.replace(",", ".")) : NaN;
        if (!Number.isFinite(n) || n <= 0) continue;
        found.set(Math.round(n * 100), typeof o.priceCurrency === "string" ? o.priceCurrency : "SEK");
      }
    }
  }
  if (found.size > 1) return "ambiguous";
  const [first] = [...found.entries()];
  return first ? { priceOre: first[0], currency: first[1] } : { priceOre: null, currency: "SEK" };
}

function movedAway(requested: string, res: Response): boolean {
  if (res.status === 404 || res.status === 410) return true;
  if (!res.url) return false;
  try {
    const want = new URL(requested).pathname.replace(/\/+$/, "");
    const got = new URL(res.url).pathname.replace(/\/+$/, "");
    if (want === got) return false;
    const slug = want.split("/").filter(Boolean).pop() ?? "";
    return slug.length > 0 && !got.toLowerCase().includes(slug.toLowerCase());
  } catch {
    return false;
  }
}

/** Butikens pris nu. Kastar aldrig på ett svar; nätfel bubblar upp till anroparen. */
export async function liveStorePrice(storeName: string, url: string, fetcher: Fetcher): Promise<LivePrice | null> {
  if (storeName === "Webhallen") {
    const id = webhallenIdFromUrl(url);
    if (!id) return null;
    const res = await fetcher(`https://www.webhallen.com/api/product/${id}`, { delayMs: 800 });
    if (res.status === 404 || res.status === 410) return { priceOre: null, currency: "SEK", note: "gone", via: "webhallen-api" };
    if (!res.ok) return null;
    const data = (await res.json()) as { product?: { price?: { price?: string; currency?: string } | null } };
    const p = parseFloat(data.product?.price?.price ?? "");
    return Number.isFinite(p) && p > 0
      ? { priceOre: Math.round(p * 100), currency: data.product?.price?.currency ?? "SEK", via: "webhallen-api" }
      : { priceOre: null, currency: "SEK", note: "no-price", via: "webhallen-api" };
  }

  const handle = shopifyHandleFromUrl(url);
  if (handle) {
    const origin = new URL(url).origin;
    const res = await fetcher(`${origin}/products/${handle}.js`, { delayMs: 800, headers: SHOPIFY_HEADERS });
    if (res.ok) {
      const p = priceFromShopifyJs((await res.json()) as never, variantIdFromUrl(url));
      if (p === "ambiguous") return { priceOre: null, currency: "SEK", note: "ambiguous", via: "shopify-js" };
      // Shopify Markets: `.js` svarar i den marknad cookien pinnar (SEK). Valutan står inte i
      // svaret — en butik som ignorerar cookien syns som en faktor-avvikelse i revisionen.
      return p != null && p > 0
        ? { priceOre: p, currency: "SEK", via: "shopify-js" }
        : { priceOre: null, currency: "SEK", note: "no-price", via: "shopify-js" };
    }
    // Ingen `.js` ⇒ Quickbutik med Shopify-lik URL — fall till JSON-LD nedan.
  }

  const res = await fetcher(url, { delayMs: 800, headers: { "accept-language": "sv-SE" } });
  if (movedAway(url, res)) return { priceOre: null, currency: "SEK", note: "gone", via: "json-ld" };
  if (!res.ok) return null;
  const p = priceFromJsonLd(await res.text());
  if (p === "ambiguous") return { priceOre: null, currency: "SEK", note: "ambiguous", via: "json-ld" };
  return p.priceOre != null ? { ...p, via: "json-ld" } : { priceOre: null, currency: "SEK", note: "no-price", via: "json-ld" };
}

export type PriceVerdict =
  | "OK"
  | "UNKNOWN"
  | "GONE"
  | "CURRENCY"
  | "EX_VAT"
  | "INC_VAT"
  | "STALE"
  | "FRESH_MISMATCH";

/** Samma pris = inom 1 % eller 1 kr (avrundning, ,00-ören). */
export function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(100, Math.round(Math.max(a, b) * 0.01));
}

export function classifyPriceMismatch(ourOre: number, live: LivePrice | null, stale: boolean): PriceVerdict {
  if (!live) return "UNKNOWN";
  if (live.note === "gone") return "GONE";
  if (live.priceOre == null) return "UNKNOWN";
  if (live.currency.toUpperCase() !== "SEK") return "CURRENCY";
  if (samePrice(ourOre, live.priceOre)) return "OK";
  if (samePrice(ourOre * 1.25, live.priceOre)) return "EX_VAT";
  if (samePrice(ourOre, live.priceOre * 1.25)) return "INC_VAT";
  return stale ? "STALE" : "FRESH_MISMATCH";
}
