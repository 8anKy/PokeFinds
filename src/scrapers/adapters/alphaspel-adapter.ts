/**
 * AlphaspelAdapter — scraper för alphaspel.se (Pokémon TCG-produkter).
 *
 * robots.txt verifierad 2026-06-11: produktsidor tillåtna
 * (checkout/admin/account/availability_alert disallowed).
 *
 * ETIK: politeFetch (robots.txt, PokeFindsBot UA, backoff).
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

const BASE_URL = "https://www.alphaspel.se";

// Alphaspel Pokémon TCG-kategori (verifierad 2026-06-11, 48 produkter/sida, ?page=N)
const CATEGORY_URLS = [
  "/1762-pokemon-tcg/",
];

interface AlphaspelRaw {
  title: string;
  priceText: string;
  priceOre: number;
  url: string;
  inStock: boolean;
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

    // Lagerstatus ur stock-diven
    const stockMatch = block.match(/<div class="stock">\s*([\s\S]*?)\s*<\/div>/);
    const stockText = stockMatch?.[1]?.replace(/<br\s*\/?>/gi, " ") ?? "";
    const inStock = !/slutsåld|ej i lager|kommer snart|bevaka/i.test(stockText);

    const imgMatch = block.match(/<img[^>]*src="(\/media\/[^"]+)"/);
    const imageUrl = imgMatch?.[1] ? `${BASE_URL}${imgMatch[1]}` : undefined;

    products.push({
      title,
      priceText: priceMatch[0],
      priceOre,
      url: `${BASE_URL}${url}`,
      inStock,
      imageUrl,
    });
  }

  return products;
}

function guessCategory(title: string): string {
  const lower = title.toLowerCase();
  if (/booster\s*(box|display)/i.test(lower)) return "BOOSTER_BOX";
  if (/elite\s*trainer/i.test(lower) || /etb/i.test(lower)) return "ETB";
  if (/booster\s*bundle/i.test(lower)) return "BUNDLE";
  if (/booster\s*pack|booster\b/i.test(lower)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/i.test(lower)) return "COLLECTION_BOX";
  if (/tin\b/i.test(lower)) return "TIN";
  if (/blister/i.test(lower)) return "BLISTER";
  if (/bundle/i.test(lower)) return "BUNDLE";
  return "OTHER";
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
              stockStatus: item.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
              imageUrl: item.imageUrl,
              category: guessCategory(item.title),
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
      return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
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
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}
