/**
 * ShopifyAdapter — återanvändbar adapter för Shopify-butiker (svenska Pokémon-
 * shoppar). Hämtar produkter + lagerstatus via det publika JSON-API:t:
 *   /collections.json              → hitta Pokémon-kollektioner
 *   /collections/{handle}/products.json → produkter (titel, pris, variant.available)
 *
 * EN bulk-JSON-hämtning ger pris + lager för hela Pokémon-katalogen → billigt nog
 * att polla ofta för restock-alerts. robots.txt tillåter products.json/collections
 * (verifierat 2026-06-14; endast sort_by- och recommendations-vägar är Disallow).
 *
 * Konkreta butiker = tunna subklasser längst ner (sätter name + baseUrl).
 * ETIK: politeFetch (robots.txt, delay, FoilioBot UA, backoff). Inga
 * inloggningar/captcha/personuppgifter.
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

interface ShopifyVariant {
  id: number;
  price: string; // major units, t.ex. "2490.00"
  available: boolean;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  tags?: string[];
  images?: { src: string }[];
  variants?: ShopifyVariant[];
}

const MAX_COLLECTIONS = 30;
const MAX_PAGES_PER_COLLECTION = 8;

function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/booster\s*(box|display)/.test(t)) return "BOOSTER_BOX";
  if (/elite\s*trainer|\betb\b/.test(t)) return "ETB";
  if (/booster\s*bundle/.test(t)) return "BUNDLE";
  if (/booster\s*pack|booster\b/.test(t)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/.test(t)) return "COLLECTION_BOX";
  if (/\btin\b/.test(t)) return "TIN";
  if (/blister/.test(t)) return "BLISTER";
  if (/bundle/.test(t)) return "BUNDLE";
  return "OTHER";
}

interface ShopifyRaw {
  productId: number;
  available: boolean;
  priceOre: number;
}
function isShopifyRaw(raw: unknown): raw is { priceOre: number; available: boolean } {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "available" in raw;
}

export abstract class ShopifyAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash, t.ex. "https://speltrollet.se"
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Hämtar Pokémon-kollektionernas handles (cachar inte — körs sällan). */
  protected async pokemonCollections(errors: string[]): Promise<string[]> {
    const res = await politeFetch(`${this.baseUrl}/collections.json?limit=250`, { delayMs: 1200 });
    if (!res.ok) {
      errors.push(`${this.name}: collections.json HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { collections?: { handle: string; title: string }[] };
    return (data.collections ?? [])
      .filter((c) => {
        const s = `${c.handle} ${c.title}`.toLowerCase();
        return /pok[eé]mon/.test(s) && !/lego|plush|gosedjur|figur/.test(s);
      })
      .map((c) => c.handle)
      .slice(0, MAX_COLLECTIONS);
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();
    try {
      const handles = await this.pokemonCollections(errors);
      for (const handle of handles) {
        for (let page = 1; page <= MAX_PAGES_PER_COLLECTION; page++) {
          const url = `${this.baseUrl}/collections/${handle}/products.json?limit=250&page=${page}`;
          const res = await politeFetch(url, { delayMs: 1200 });
          if (!res.ok) {
            errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          const data = (await res.json()) as { products?: ShopifyProduct[] };
          const batch = data.products ?? [];
          if (batch.length === 0) break;
          for (const p of batch) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            const raw = this.toRaw(p);
            if (raw) products.push(raw);
          }
          if (batch.length < 250) break;
        }
      }
    } catch (err) {
      errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { products, errors };
  }

  private toRaw(p: ShopifyProduct): RawProductData | null {
    const variants = p.variants ?? [];
    if (variants.length === 0) return null;
    const anyAvailable = variants.some((v) => v.available);
    // Visa billigaste köpbara variantens pris (annars billigaste variant alls).
    const pool = variants.filter((v) => v.available);
    const priceVariant = (pool.length ? pool : variants).reduce((a, b) =>
      parseFloat(b.price) < parseFloat(a.price) ? b : a
    );
    const priceOre = Math.round(parseFloat(priceVariant.price) * 100);
    if (!Number.isFinite(priceOre) || priceOre <= 0) return null;
    const rawData: ShopifyRaw = { productId: p.id, available: anyAvailable, priceOre };
    return {
      externalId: `${this.idPrefix}-${p.id}`,
      title: p.title.trim(),
      url: `${this.baseUrl}/products/${p.handle}`,
      price: priceOre,
      currency: "SEK",
      stockStatus: anyAvailable ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
      imageUrl: p.images?.[0]?.src,
      category: guessCategory(p.title),
      raw: rawData,
    };
  }

  protected get idPrefix(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    if (isShopifyRaw(raw)) return raw.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isShopifyRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

// ---------- Konkreta butiker (Shopify) ----------
export class SpeltrolletAdapter extends ShopifyAdapter {
  name = "Speltrollet";
  baseUrl = "https://speltrollet.se";
}
export class SamlarhobbyAdapter extends ShopifyAdapter {
  name = "Samlarhobby";
  baseUrl = "https://samlarhobby.se";
}
export class GoblinenAdapter extends ShopifyAdapter {
  name = "Goblinen";
  baseUrl = "https://goblinen.com";
}
// Dragon's Lair bytte plattform (Vendre → Shopify) ~2026-07. Fler-spels-butik:
// collections.json-namnfiltret hittar inte de generiska sealed-kollektionerna, men
// master-kollektionen "pokemon-the-trading-card-game" täcker allt Pokémon-sealed.
export class DragonsLairAdapter extends ShopifyAdapter {
  name = "Dragon's Lair";
  baseUrl = "https://dragonslair.se";
  protected async pokemonCollections(): Promise<string[]> {
    return ["pokemon-the-trading-card-game"];
  }
}
