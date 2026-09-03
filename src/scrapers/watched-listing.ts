/**
 * BEVAKADE LÄNKAR: fråga EN butiks-URL direkt, som om den kom ur feeden.
 *
 * ⛔ VARFÖR. Feedarna är vår enda upptäcktsväg och de är inte kompletta. Goblinen
 * publicerade 30th Celebration-ETB:n 2026-09-03: produktsidan svarar 200, men URL:en
 * finns varken i kollektions-JSON:en, `/products.json`, sökindexet, i
 * `sitemap_products_1.xml` (1,1 MB produkt-URL:er, noll träffar) eller i Atom-feeden.
 * En konkurrents Discord larmade ändå — de KÄNDE URL:en. `WatchedListing` är listan
 * över sådana URL:er, och den här filen är hur vi frågar dem.
 *
 * ⛔ SVARET FORMAS SOM EN FEED-POST, INTE SOM EN NY KODVÄG. Returvärdet är exakt
 * `FeedItem` — samma form `fetchSourceFeed` producerar — och splitsas in i butikens
 * lista i fas 1 av `runRestockScan`. Därmed går bevakade länkar genom PRECIS samma
 * offer-diff, samma köpbarhetskoll, samma auto-import, samma larmvakter och samma
 * Discord-routing som allt annat. En parallell "bevakningslane" hade betytt två
 * sanningar om samma lagerstatus, och två sanningar är hur flappen uppstår.
 *
 * ⛔ RÖR ALDRIG DATABASEN. Fas 1 måste vara DB-fri (Neon debiteras per vaken tid, och
 * Discord-lanens hela existensberättigande är att den aldrig väcker den). Listan över
 * vad som ska frågas skickas IN av anroparen — från Prisma i DB-lanerna, ur den
 * cachade ruttabellen i Discord-lanen.
 *
 * ⛔ `null` BETYDER "VET INTE", ALDRIG "SLUT". Ett 429, en timeout eller en sida utan
 * strukturerad data ger null, och anroparen behåller då det den redan visste. Samma
 * regel som `verifyStockForUrl` och som frånvaro-ur-feeden: absence is not evidence.
 */
import { StockStatus } from "@prisma/client";
import { politeFetch } from "./http";
import { guessListingCategory } from "./listing-category";
import {
  shopifyHandleFromUrl,
  variantIdFromUrl,
  parseJsonLdBlocks,
  collectProductNodes,
  productNameFromHtml,
} from "./gtin-source";
import {
  resolveStockStrategy,
  stockFromShopifyJs,
  stockFromJsonLd,
  fetchShopifyPurchasable,
} from "./stock-verify";

/** Samma form som `fetchSourceFeed` ger — se filhuvudet för varför det är ett krav. */
export interface WatchedFeedItem {
  url: string;
  stockStatus: StockStatus;
  title: string;
  price: number | null;
  imageUrl: string | null;
  category: string | null;
}

export interface WatchedFetchResult {
  item: WatchedFeedItem | null;
  /** Kort, mänskligt skäl när `item` är null. Visas i adminlistan, aldrig för besökare. */
  error: string | null;
}

interface ShopifyJs {
  title?: string;
  available?: boolean;
  price?: number; // butikens minsta enhet (öre för SEK)
  featured_image?: string | null;
  images?: string[];
  variants?: { id?: number; available?: boolean; price?: number; featured_image?: { src?: string } | null }[];
}

/** Absolut bild-URL ur Shopifys protokoll-lösa `//cdn.shopify.com/...`. */
function absolutize(src: string | null | undefined, pageUrl: string): string | null {
  if (!src) return null;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("http")) return src;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Pris ur ett schema.org-Product-block, i ÖRE.
 *
 * ⛔ 0 ÄR INGET PRIS (kostnadsdoktrinen, `priceOreFromEur`): ett icke-positivt belopp
 * returneras som null så att gränssnittet visar "–" i stället för "0 kr". Butiker
 * publicerar 0 för "ring för pris" och för produkter utan lagersaldo.
 */
function priceOreFromJsonLd(node: Record<string, unknown>): number | null {
  const offers = node.offers;
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const raw = (o as Record<string, unknown>).price ?? (o as Record<string, unknown>).lowPrice;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return null;
}

function imageFromJsonLd(node: Record<string, unknown>, pageUrl: string): string | null {
  const img = node.image;
  const first = Array.isArray(img) ? img[0] : img;
  if (typeof first === "string") return absolutize(first, pageUrl);
  if (first && typeof first === "object") {
    const u = (first as Record<string, unknown>).url;
    if (typeof u === "string") return absolutize(u, pageUrl);
  }
  return null;
}

/**
 * Hämtar en bevakad butiks-URL och formar svaret som en feed-post.
 *
 * Kastar ALDRIG. `sourceName` avgör strategin på exakt samma sätt som
 * `verifyStockForUrl` — bevakningen får inte kunna tolka en butik annorlunda än
 * resten av kedjan gör.
 */
export async function fetchWatchedListing(
  sourceName: string,
  url: string
): Promise<WatchedFetchResult> {
  try {
    const strategy = resolveStockStrategy(sourceName, url);

    if (strategy === "shopify-js") {
      const handle = shopifyHandleFromUrl(url);
      if (!handle) return { item: null, error: "kunde inte läsa Shopify-handle ur URL:en" };
      const origin = new URL(url).origin;
      // Svenska marknaden pinnad — håll requesten IDENTISK med ShopifyAdapterns,
      // annars får vi den utländska marknadens ex-moms-pris (se SE_MARKET_HEADERS).
      const res = await politeFetch(`${origin}/products/${handle}.js`, {
        delayMs: 800,
        headers: { cookie: "localization=SE", "accept-language": "sv-SE" },
      });
      if (!res.ok) return { item: null, error: `HTTP ${res.status} på /products/${handle}.js` };
      const data = (await res.json()) as ShopifyJs;

      const wanted = variantIdFromUrl(url);
      const variant = wanted !== null ? (data.variants ?? []).find((v) => v.id === wanted) : null;
      if (wanted !== null && !variant) {
        // Varianten är borta ur butiken → vi vet inget om DEN varan längre.
        return { item: null, error: `variant ${wanted} finns inte längre på sidan` };
      }

      let status = stockFromShopifyJs(data, wanted);
      if (status === null) return { item: null, error: "Shopify svarade utan lagerfält" };
      // ⛔ `available: true` ≠ köpbar (Kortarkivet 2026-08-15: alla tre "definitiva"
      // fälten sa i lager medan köpknappen var `disabled`). Bekräfta mot storefronten
      // innan vi påstår något som kan bli ett larm. Obestämbart ⇒ behåll feedens ord.
      if (status === StockStatus.IN_STOCK) {
        const purchasable = await fetchShopifyPurchasable(url);
        if (purchasable === false) status = StockStatus.OUT_OF_STOCK;
      }

      const priceRaw = variant?.price ?? data.price;
      const price = typeof priceRaw === "number" && priceRaw > 0 ? priceRaw : null;
      const title = (data.title ?? "").trim();
      if (!title) return { item: null, error: "Shopify svarade utan titel" };

      return {
        item: {
          url,
          stockStatus: status,
          title,
          price,
          imageUrl:
            absolutize(variant?.featured_image?.src, url) ??
            absolutize(data.featured_image, url) ??
            absolutize(data.images?.[0], url),
          category: guessListingCategory(title),
        },
        error: null,
      };
    }

    // Alla andra butiker: EN hämtning av produktsidan, läst via schema.org.
    // (Webhallen har en egen strategi för lager men publicerar JSON-LD på sidan —
    // den här vägen räcker, och en bevakad Webhallen-länk är ändå ovanlig.)
    const res = await politeFetch(url, { delayMs: 800 });
    if (!res.ok) return { item: null, error: `HTTP ${res.status}` };
    const html = await res.text();

    const status = stockFromJsonLd(html);
    if (status === null) {
      return { item: null, error: "sidan saknar läsbar strukturerad lagerdata (JSON-LD)" };
    }
    const node = parseJsonLdBlocks(html).flatMap((b) => collectProductNodes(b))[0] ?? {};
    const title = productNameFromHtml(html)?.trim();
    if (!title) return { item: null, error: "sidan saknar produktnamn i JSON-LD" };

    return {
      item: {
        url,
        stockStatus: status,
        title,
        price: priceOreFromJsonLd(node),
        imageUrl: imageFromJsonLd(node, url),
        category: guessListingCategory(title),
      },
      error: null,
    };
  } catch (err) {
    return { item: null, error: err instanceof Error ? err.message : String(err) };
  }
}
