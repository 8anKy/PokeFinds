/**
 * AlphaspelAdapter — scraper för alphaspel.se (Pokémon TCG-produkter).
 *
 * robots.txt verifierad 2026-06-11: produktsidor tillåtna
 * (checkout/admin/account/availability_alert disallowed).
 *
 * ETIK: politeFetch (robots.txt, FoilioBot UA, backoff).
 */
import { StockStatus, SourceType } from "@prisma/client";
import { politeFetch } from "../http";
import { normalizeTitle } from "../../lib/utils";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";
import { guessListingCategory } from "../listing-category";

const BASE_URL = "https://www.alphaspel.se";

// Alphaspel Pokémon TCG-kategori (verifierad 2026-06-11, 48 produkter/sida, ?page=N)
const CATEGORY_URLS = [
  "/1762-pokemon-tcg/",
];

type AlphaspelStock = "in" | "preorder" | "out";

interface AlphaspelRaw {
  title: string;
  priceText: string;
  priceOre: number;
  url: string;
  /** Kvar för gamla rawData-rader (före 2026-09-17); nya rader bär `stock`. */
  inStock: boolean;
  stock?: AlphaspelStock;
  imageUrl?: string;
}

function isAlphaspelRaw(raw: unknown): raw is AlphaspelRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "url" in raw;
}

function parseSekPrice(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(/kr|SEK/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

/**
 * Alphaspel lagerstatus. ALLOWLIST (inte denylist): köpbar bara när texten
 * uttryckligen visar tillgängligt antal — "I lager", "N i butiken", "N på
 * postorder". Allt annat (Slutsåld, Ej i lager, "Första leveransen fullbokad…",
 * framtida okända fraser) = ur lager. Säkra riktningen: hellre ur lager än
 * falskt "i lager".
 */
export function alphaspelInStock(stockText: string): boolean {
  const t = stockText.toLowerCase();
  return (
    /i butiken|på postorder/.test(t) || (/i lager/.test(t) && !/ej i lager/.test(t))
  );
}

/**
 * Alphaspels lagerstatus ur KNAPPEN, inte texten. Varje grid-kort bär en
 * `add-to-cart`-knapp i tre lägen (mätt 2026-09-17 över 188 kort):
 *   `btn-success add-to-cart` "Köp"          → i lager
 *   `btn-primary add-to-cart` "Boka"         → bokningsbar förhandsbokning (KÖPBAR)
 *   `btn-default disabled add-to-cart` "Köp" → går inte att köpa
 * Texten ensam missade 30th Celebration-släppet 2026-09-17 12:00: en öppen
 * förhandsbokning står som "Preliminärt <datum>" (eller t.o.m. "Ej i lager") med
 * en aktiv Boka-knapp, och allowlisten dömde den ur lager hela vägen tills
 * "Första leveransen fullbokad" — noll flippar, noll inlägg, medan konkurrenten
 * larmade. Knappen är butikens EGEN köpbarhetsdom; texten är bara fallback när
 * kortet saknar knapp.
 */
export function alphaspelStockStatus(stockText: string, buttonHtml: string | null): AlphaspelStock {
  if (buttonHtml) {
    if (/\bdisabled\b/.test(buttonHtml)) return "out";
    if (/fa-hourglass|>\s*Boka\s*</i.test(buttonHtml)) return "preorder";
    return "in";
  }
  return alphaspelInStock(stockText) ? "in" : "out";
}

const STATUS_BY_STOCK: Record<AlphaspelStock, StockStatus> = {
  in: StockStatus.IN_STOCK,
  preorder: StockStatus.PREORDER,
  out: StockStatus.OUT_OF_STOCK,
};

/** Avkodar de vanligaste HTML-entiteterna i titlar. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Alphaspel (verifierad 2026-06-11) renderar produktkort som:
 *   <div class="product">
 *     <a href="/1762-pokemon-tcg/298568-...">
 *       <img class="... thumb-default-product" src="/media/products/thumbs/...">
 *       <div class="product-name">Titel <small>...</small></div>
 *     </a>
 *     <div class="price-and-stock"> ... <div class="price text-success">119 kr</div>
 *       <div class="stock">I lager / Slutsåld / Fler än 20 i butiken...</div>
 *     <a class="btn w-100 btn-success add-to-cart" href="...">Köp</a>   (se alphaspelStockStatus)
 */
function extractProducts(html: string): AlphaspelRaw[] {
  const products: AlphaspelRaw[] = [];

  const blocks = html.split(/<div class="product">/);

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].slice(0, 5000);

    const linkMatch = block.match(/<a href="(\/[^"]+)">/);
    if (!linkMatch) continue;
    const url = linkMatch[1];

    const nameMatch = block.match(/<div class="product-name">\s*([\s\S]*?)\s*(?:<small|<\/div)/);
    if (!nameMatch) continue;
    const title = decodeEntities(nameMatch[1].replace(/\s+/g, " ").trim());
    if (!title || !url) continue;

    // Pris: <div class="price text-success">119 kr</div>
    const priceMatch = block.match(/class="price[^"]*"\s*>\s*([\d\s.,]+)\s*kr/);
    if (!priceMatch) continue;
    const priceOre = parseSekPrice(priceMatch[1]);
    if (!priceOre) continue;

    // Lagerstatus ur köpknappen, texten som fallback (se alphaspelStockStatus).
    const stockMatch = block.match(/<div class="stock">\s*([\s\S]*?)\s*<\/div>/);
    const stockText = stockMatch?.[1]?.replace(/<br\s*\/?>/gi, " ") ?? "";
    const buttonMatch = block.match(/<a\b[^>]*class="[^"]*\badd-to-cart\b[^"]*"[^>]*>[\s\S]*?<\/a>/);
    const stock = alphaspelStockStatus(stockText, buttonMatch?.[0] ?? null);

    const imgMatch = block.match(/<img[^>]*src="(\/media\/[^"]+)"/);
    const imageUrl = imgMatch?.[1] ? `${BASE_URL}${imgMatch[1]}` : undefined;

    products.push({
      title,
      priceText: priceMatch[0],
      priceOre,
      url: `${BASE_URL}${url}`,
      inStock: stock === "in",
      stock,
      imageUrl,
    });
  }

  return products;
}


export class AlphaspelAdapter implements SourceAdapter {
  name = "Alphaspel";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];

    for (const categoryPath of CATEGORY_URLS) {
      try {
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 10) {
          const url = `${BASE_URL}${categoryPath}${page > 1 ? `?page=${page}` : ""}`;
          const res = await politeFetch(url, { delayMs: 2000 });
          if (!res.ok) {
            errors.push(`HTTP ${res.status} från ${url}`);
            break;
          }
          const html = await res.text();
          const found = extractProducts(html);
          if (found.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of found) {
            if (!/pok[eé]mon/i.test(item.title) && !/tcg/i.test(item.title)) continue;

            products.push({
              externalId: `alphaspel-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
              title: item.title,
              url: item.url,
              price: item.priceOre,
              currency: "SEK",
              stockStatus: STATUS_BY_STOCK[item.stock ?? (item.inStock ? "in" : "out")],
              imageUrl: item.imageUrl,
              category: guessListingCategory(item.title),
              raw: item,
            });
          }

          page++;
          if (!html.includes(`?page=${page}`)) {
            hasMore = false;
          }
        }
      } catch (err) {
        errors.push(
          `Alphaspel ${categoryPath}: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    return { products, errors };
  }

  normalizeProduct(raw: RawProductData): NormalizedProduct {
    return {
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      imageUrl: raw.imageUrl,
      category: raw.category,
    };
  }

  detectStockStatus(raw: unknown): StockStatus {
    if (isAlphaspelRaw(raw)) {
      return STATUS_BY_STOCK[raw.stock ?? (raw.inStock ? "in" : "out")];
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isAlphaspelRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      p.price !== null && // okänt pris släpps BARA igenom av Shopify (types.ts) — här krävs ett tal
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}
