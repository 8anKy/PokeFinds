/**
 * WebhallenAdapter — hämtar Pokémon TCG-produkter via Webhallens publika API.
 *
 * robots.txt verifierad 2026-06-11: produktsidor tillåtna.
 * Webhallen exponerar en JSON-API under /api/search som returnerar
 * strukturerad produktdata — inget HTML-scraping behövs.
 *
 * ETIK: politeFetch (robots.txt, crawl-delay, FoilioBot UA, backoff).
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

const BASE_URL = "https://www.webhallen.com";

/**
 * Webhallens publika sök-API (verifierat 2026-06-11):
 *   GET /api/productdiscovery/search/{query}?page={n}&touchpoint=DESKTOP
 * Returnerar { products: [...] } med pris, lager och kategoriträd.
 * OBS: sidnummer måste skickas som ?page= (path-segment ignoreras).
 */
const SEARCH_QUERY = "pokemon";
const MAX_PAGES = 5;

function searchUrl(page: number): string {
  return `${BASE_URL}/api/productdiscovery/search/${encodeURIComponent(SEARCH_QUERY)}?page=${page}&touchpoint=DESKTOP&totalProductCountSet=true`;
}

interface WebhallenProduct {
  id: number;
  name: string;
  price: { price: string; currency: string } | null;
  stock?: { web?: number | null } | null;
  regularPrice?: { price: string };
  /** T.ex. "Leksaker & Hobby/Samlarkortspel/Pokémon" */
  categoryTree?: string | null;
  thumbnail?: string;
}

interface WebhallenRaw {
  id: number;
  name: string;
  priceOre: number;
  url: string;
  inStock: boolean;
  imageUrl?: string;
  rawProduct: WebhallenProduct;
}

function isWebhallenRaw(raw: unknown): raw is WebhallenRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "id" in raw;
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

export class WebhallenAdapter implements SourceAdapter {
  name = "Webhallen";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = true;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];

    try {
      const seen = new Set<number>();

      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await politeFetch(searchUrl(page), {
          delayMs: 2000,
          headers: { accept: "application/json" },
        });

        if (!res.ok) {
          errors.push(`Webhallen API HTTP ${res.status}`);
          break;
        }

        const json = (await res.json()) as {
          products?: WebhallenProduct[];
        };
        const items = json.products ?? [];

        if (items.length === 0) break;

        let newOnPage = 0;
        for (const item of items) {
          if (!item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          newOnPage++;

          if (!item.name || !item.price?.price) continue;
          // Endast samlarkortspel — filtrera bort plush/merch via kategoriträdet
          if (item.categoryTree && !/samlarkort/i.test(item.categoryTree)) continue;
          if (!/pok[eé]mon/i.test(item.name)) continue;

          const priceSek = parseFloat(item.price.price);
          if (!Number.isFinite(priceSek) || priceSek <= 0) continue;
          const priceOre = Math.round(priceSek * 100);

          const inStock = (item.stock?.web ?? 0) > 0;
          const productUrl = `${BASE_URL}/se/product/${item.id}`;

          const raw: WebhallenRaw = {
            id: item.id,
            name: item.name,
            priceOre,
            url: productUrl,
            inStock,
            imageUrl: item.thumbnail,
            rawProduct: item,
          };

          products.push({
            externalId: `webhallen-${item.id}`,
            title: item.name,
            url: productUrl,
            price: priceOre,
            currency: "SEK",
            stockStatus: inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
            imageUrl: item.thumbnail,
            category: guessCategory(item.name),
            raw,
          });
        }

        // Sista sidan upprepar ofta tidigare produkter — stoppa när inget nytt kommer
        if (newOnPage === 0) break;
      }
    } catch (err) {
      errors.push(
        `Webhallen: ${err instanceof Error ? err.message : err}`
      );
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
    if (isWebhallenRaw(raw)) {
      return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isWebhallenRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
