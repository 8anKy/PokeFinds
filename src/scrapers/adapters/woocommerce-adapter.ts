/**
 * WooCommerceAdapter — återanvändbar adapter för WooCommerce-butiker via det PUBLIKA
 * Store API:t (`/wp-json/wc/store/v1/…`). Det är WooCommerces egen läs-endpoint för
 * butiksfronten: ingen nyckel, ingen inloggning, samma data som butikssidan renderar.
 *
 *   /products/categories?per_page=100   → hitta Pokémon-kategorierna
 *   /products?category={id}&per_page=100 → produkter (namn, pris, lager, bild, SKU)
 *
 * VARFÖR JSON OCH INTE HTML: de tre butikerna kör tre olika teman, och en HTML-parser
 * per tema hade varit tre fragila adaptrar. Store API:t är versionerat (v1) och
 * identiskt i alla tre — samma resonemang som Shopifys products.json.
 *
 * ⛔ PRISET ÄR REDAN I MINSTA ENHET, men enheten står i svaret. `prices.price` är en
 *    STRÄNG i minor units och `currency_minor_unit` säger hur många decimaler de
 *    representerar ("129900" med minor_unit 2 = 1 299,00 kr = 129 900 öre). Läs den
 *    ALDRIG som kronor och multiplicera aldrig blint med 100 — en butik som byter till
 *    minor_unit 0 hade då blivit 100x för dyr, tyst.
 *
 * ⛔ VALUTAN MÅSTE VARA SEK. Store API:t serverar butikens valuta; en butik med
 *    multivaluta kan svara i EUR beroende på geo, och våra jobb kör i ett
 *    US-datacenter (samma fälla som Shopify Markets, se SE_MARKET_HEADERS där).
 *    Vi släpper därför bara igenom SEK — hellre en tom feed än priser i fel valuta.
 *
 * Konkreta butiker = tunna subklasser längst ner (sätter name + baseUrl).
 * ETIK: politeFetch (robots.txt, delay, FoilioBot UA, backoff).
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

const MAX_CATEGORIES = 12;
const PER_PAGE = 100;
const MAX_PAGES_PER_CATEGORY = 5;

interface WooPrices {
  price: string;
  currency_code?: string;
  currency_minor_unit?: number;
}
interface WooProduct {
  id: number;
  name: string;
  permalink: string;
  sku?: string;
  prices?: WooPrices;
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  images?: { src: string }[];
}
interface WooCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

/**
 * Kategorier som ALDRIG hämtas. Samma skäl som Shopifys NON_SEALED_COLLECTION, men
 * här är behovet akut: Pocketmonsters Pokémon-kategorier rymmer 268 gosedjur, 515
 * figurer, 220 artiklar "till barnrummet", 149 pärmar och 1 592 poster under
 * "pokemonkort" (löskort). Utan filtret hade adaptern hämtat tusentals annonser som
 * vakterna sedan kastar en och en — dyrt och helt i onödan.
 */
const NON_SEALED_CATEGORY =
  /l[oö]s(a|t)?[\s-]*kort|l[oö]skort|\bsingles?\b|\bsinglar\b|singel|gradera|\bgraded\b|\bslabs?\b|gosedjur|mjukisdjur|plush|figur|affisch|poster|kl[äa]der|barnrum|skolan|p[äa]rm|mynt|nyckelring|tr[äa]narkort|stora[\s-]*kort|speciella|shiny|break[\s-]*kort|\bv-?l[oö]skort|pok[eé]mon-?kort\b/i;


interface WooRaw {
  productId: number;
  priceOre: number;
  available: boolean;
  sku?: string;
}
function isWooRaw(raw: unknown): raw is WooRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "available" in raw;
}

/**
 * Store API-pris → öre. Ren funktion: hela minor-unit-fällan ligger på ETT ställe och
 * går att testa utan nät. Returnerar null när priset saknas, är noll eller när valutan
 * inte är SEK — "0 kr är inget pris" (se exchange-rate.ts för samma regel).
 */
export function wooPriceOre(prices: WooPrices | undefined): number | null {
  if (!prices) return null;
  if ((prices.currency_code ?? "SEK").toUpperCase() !== "SEK") return null;
  const minor = prices.currency_minor_unit ?? 2;
  const raw = Number(prices.price);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // minor=2 → redan öre. minor=0 → hela kronor. minor=3 → tiondels öre.
  const ore = Math.round(raw * 10 ** (2 - minor));
  return ore > 0 ? ore : null;
}

export abstract class WooCommerceAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Sökord som används när butiken saknar en namngiven Pokémon-kategori. */
  protected searchTerms: string[] = ["pokemon"];

  private api(path: string): string {
    return `${this.baseUrl}/wp-json/wc/store/v1/${path}`;
  }

  private async json<T>(url: string, errors: string[]): Promise<T | null> {
    try {
      const res = await politeFetch(url, { delayMs: 1200, headers: { "accept-language": "sv-SE" } });
      if (!res.ok) {
        errors.push(`${this.name}: ${url} HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Pokémon-kategorier värda att hämta (sealed), tomt = falla tillbaka på sökning. */
  protected async pokemonCategories(errors: string[]): Promise<WooCategory[]> {
    const found: WooCategory[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.json<WooCategory[]>(
        this.api(`products/categories?per_page=${PER_PAGE}&page=${page}`),
        errors
      );
      if (!batch?.length) break;
      found.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    return found
      .filter((c) => {
        const s = `${c.slug} ${c.name}`.toLowerCase();
        return /pok[eé]mon/.test(s) && !/lego/.test(s) && !NON_SEALED_CATEGORY.test(s);
      })
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CATEGORIES);
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<number>();

    const push = (p: WooProduct) => {
      if (seen.has(p.id)) return;
      const priceOre = wooPriceOre(p.prices);
      if (priceOre === null) return; // ingen valuta/pris vi kan lita på → hoppa
      if (!p.permalink?.startsWith("http")) return;
      seen.add(p.id);
      products.push({
        externalId: `${this.idPrefix}-${p.id}`,
        title: p.name,
        url: p.permalink,
        price: priceOre,
        currency: "SEK",
        stockStatus: p.is_in_stock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
        imageUrl: p.images?.[0]?.src,
        category: guessListingCategory(p.name),
        raw: { productId: p.id, priceOre, available: !!p.is_in_stock, sku: p.sku } satisfies WooRaw,
      });
    };

    const categories = await this.pokemonCategories(errors);
    const queries = categories.length
      ? categories.map((c) => `category=${c.id}`)
      : this.searchTerms.map((t) => `search=${encodeURIComponent(t)}`);

    for (const q of queries) {
      for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
        const batch = await this.json<WooProduct[]>(
          this.api(`products?${q}&per_page=${PER_PAGE}&page=${page}`),
          errors
        );
        if (!batch?.length) break;
        for (const p of batch) push(p);
        if (batch.length < PER_PAGE) break;
      }
    }
    return { products, errors };
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
    if (isWooRaw(raw)) return raw.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isWooRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

// ---------- Konkreta butiker (WooCommerce) ----------
// Fantasia North har 400 kategorier varav EN heter "pokemon" (29 varor) — den räcker.
export class FantasiaNorthAdapter extends WooCommerceAdapter {
  name = "Fantasia North";
  baseUrl = "https://fantasianorth.com";
}
export class TheSwedishFishAdapter extends WooCommerceAdapter {
  name = "The Swedish Fish";
  baseUrl = "https://theswedishfish.se";
}
// Leksaksbutik med ett litet TCG-hörn: 22 Pokémon-kategorier, men nästan allt är
// gosedjur, figurer och löskort. NON_SEALED_CATEGORY lämnar kvar boxar/boosterpacks
// och kortpaket — resten stoppas ändå av merch- och singel-vakterna i runnern.
export class PocketmonstersAdapter extends WooCommerceAdapter {
  name = "Pocketmonsters";
  baseUrl = "https://pocketmonsters.se";
}
