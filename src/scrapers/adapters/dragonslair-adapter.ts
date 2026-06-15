/**
 * DragonsLairAdapter — scraper för dragonslair.se (Pokémon TCG-produkter).
 *
 * robots.txt verifierad 2026-06-11: tillåter crawling (crawl-delay 10s).
 * Hämtar Pokémon TCG-kategorisidor och extraherar produktdata ur HTML.
 *
 * ETIK: politeFetch (robots.txt, FoilioBot UA, backoff).
 * Crawl-delay satt till 10s per robots.txt.
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

const BASE_URL = "https://dragonslair.se";

// Dragon's Lair Pokémon TCG-kategorier (verifierade 2026-06-11, ?page=N för paginering)
const CATEGORY_URLS = [
  "/samlarkortspel/pokemon-the-trading-card-game/booster-box/",
  "/samlarkortspel/pokemon-the-trading-card-game/pokemon-booster-pack/",
  "/samlarkortspel/pokemon-the-trading-card-game/special-boxar-tins/",
  "/samlarkortspel/pokemon-the-trading-card-game/fardiga-lekar-c572/",
];

/** robots.txt anger crawl-delay: 10 — vi respekterar detta. */
const CRAWL_DELAY_MS = 10_000;

interface DragonsLairRaw {
  title: string;
  priceText: string;
  priceOre: number;
  url: string;
  inStock: boolean;
  imageUrl?: string;
}

function isDragonsLairRaw(raw: unknown): raw is DragonsLairRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "url" in raw;
}

function parseSekPrice(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(/kr|SEK/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

/** Avkodar de vanligaste HTML-entiteterna i titlar/attribut. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Dragon's Lair (Vendre-plattform, verifierad 2026-06-11) renderar:
 *  - titel/URL:  <h2 class="product-name"><a href="..." data-product-clicked="ID" data-product-id="ID">Titel</a></h2>
 *  - prisdata:   :product-data="{...HTML-enkodad JSON med id, in_stock, price_raw...}"
 * Vi parar ihop produktnamn med prisdata via produkt-ID.
 */
function extractProducts(html: string): DragonsLairRaw[] {
  const products: DragonsLairRaw[] = [];

  // 1) Prisdata per produkt-ID ur :product-data-attributen
  interface VendreProductData {
    id: string;
    in_stock: boolean;
    price_raw: number | null;
    price_special_raw: number | null;
  }
  const dataById = new Map<string, VendreProductData>();
  const dataPattern = /:product-data="([^"]+)"/g;
  let dataMatch: RegExpExecArray | null;
  while ((dataMatch = dataPattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(decodeEntities(dataMatch[1])) as VendreProductData;
      if (parsed?.id) dataById.set(String(parsed.id), parsed);
    } catch {
      // Trasig JSON i ett attribut — hoppa över
    }
  }

  // 2) Produktnamn + URL ur product-name-rubrikerna
  const namePattern =
    /<h2 class="product-name">\s*<a\s+href="([^"]+)"\s+data-product-clicked="\d+"\s+data-product-id="(\d+)"\s*>\s*([\s\S]*?)\s*<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(html)) !== null) {
    const url = match[1];
    const id = match[2];
    const title = decodeEntities(match[3].replace(/\s+/g, " ").trim());
    if (!title || !url) continue;

    const data = dataById.get(id);
    if (!data) continue;

    const priceSek = data.price_special_raw ?? data.price_raw;
    if (typeof priceSek !== "number" || !Number.isFinite(priceSek) || priceSek <= 0) continue;
    const priceOre = Math.round(priceSek * 100);

    products.push({
      title,
      priceText: `${priceSek} kr`,
      priceOre,
      url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
      inStock: data.in_stock === true,
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

export class DragonsLairAdapter implements SourceAdapter {
  name = "Dragon's Lair";
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

        // Max 3 sidor per kategori — crawl-delay 10s gör fler sidor långsamt
        while (hasMore && page <= 3) {
          const url = `${BASE_URL}${categoryPath}${page > 1 ? `?page=${page}` : ""}`;
          const res = await politeFetch(url, { delayMs: CRAWL_DELAY_MS });
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
              externalId: `dragonslair-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
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
          `Dragon's Lair ${categoryPath}: ${err instanceof Error ? err.message : err}`
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
    if (isDragonsLairRaw(raw)) {
      return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isDragonsLairRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
