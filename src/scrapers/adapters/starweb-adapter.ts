/**
 * StarwebAdapter — adapter för Starweb-butiker (svensk e-com-plattform, server-
 * renderad kategori-HTML). Byggd för Coolcard; basklassen är återanvändbar om fler
 * Starweb-butiker dyker upp.
 *
 * Upptäckt (probe 2026-08-13): kategorin /category/pokmon (butikens EGEN stavning,
 * utan é — rätta den ALDRIG till "pokemon", då blir det 404) listar 48 produkter/sida
 * och paginerar via ?page=1..4. Varje produktkort:
 *   <li class="gallery-item gallery-item-stock-status-N">
 *     <a href="/product/{slug}" class="gallery-info-link product-info"
 *        title="Titel - kort beskrivning" data-sku="POK10359-101" data-id="59336">
 *     … <h3>Titel</h3> … <p class="product-sku">POK10359-101</p>
 *     <span class="price"><span class="amount">749</span><span class="currency"> kr</span></span>
 *     <dd class="stock-status">I lager | N st i lager | Slutsåld</dd>
 *     <button … data-price="749" data-currency="SEK">
 * Mätt på sidan: "I lager"(3) + "N st i lager"(36) + "Slutsåld"(9) = 48 — lagertexten
 * finns alltså på VARJE kort. Sidan innehåller även ett {{mustache}}-mallblock för
 * JS-rendering — segment med "{{" hoppas (mallen är inte en produkt).
 *
 * robots.txt (verifierad 2026-08-13): blockerar bara /search och /customer?redirect=* —
 * kategorisidor tillåtna. data-currency="SEK" på köpknappen + data-currency="SEK" på
 * <html> → priser i SEK.
 *
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
import { guessListingCategory } from "../listing-category";

const MAX_PAGES = 8; // 4 sidor uppmätta 2026-08-13 — 8 ger utrymme att växa
const PAGE_DELAY_MS = 1500;
/** Bunden segmentlängd per produktkort — mot patologisk backtracking. */
const ITEM_SLICE = 8_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseSekPrice(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "").replace(/kr|sek/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}


export type StarwebStock = "in" | "out" | "unknown";

export interface StarwebItem {
  url: string; // absolut, på butikens kanoniska värd
  title: string;
  priceOre: number;
  stock: StarwebStock;
  sku?: string;
  dataId?: string;
  imageUrl?: string;
}

interface StarwebRaw {
  priceOre: number;
  stock: StarwebStock;
  url: string;
  sku?: string;
}
function isStarwebRaw(raw: unknown): raw is StarwebRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw;
}

/** Lagertext → dom. "N st i lager"/"I lager" → in; "Slutsåld" → out; annat → unknown. */
export function starwebStockFromText(text: string | undefined): StarwebStock {
  if (!text) return "unknown";
  if (/slutsåld|slut i lager/i.test(text)) return "out";
  if (/lager/i.test(text)) return "in";
  return "unknown";
}

/**
 * Plockar produktkorten ur en Starweb-kategorisida. Ren funktion → testbar utan nät.
 * `canonicalBase` = värden produktlänkarna absolutiseras mot (utan avslutande slash).
 */
export function parseStarwebListing(html: string, canonicalBase: string): StarwebItem[] {
  const out: StarwebItem[] = [];
  const items = html.split(/class="gallery-item(?=[ "])/).slice(1);
  for (const raw of items) {
    const seg = raw.slice(0, ITEM_SLICE);
    // JS-mallblocket ({{productName}} osv.) är inget produktkort.
    if (seg.slice(0, 400).includes("{{")) continue;

    const hrefM = seg.match(/href="(\/product\/[^"]+)"/);
    if (!hrefM) continue;
    const url = `${canonicalBase}${decodeEntities(hrefM[1]).split("#")[0].split("?")[0]}`;

    // Titel: <h3> är ren produkttitel; title-attributet bär "Titel - beskrivning".
    const h3 = seg.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1];
    const titleAttr = seg.match(/class="[^"]*product-info[^"]*"[^>]*title="([^"]*)"/)?.[1]
      ?? seg.match(/title="([^"]*)"[^>]*class="[^"]*product-info[^"]*"/)?.[1];
    let title = decodeEntities(h3 ?? titleAttr ?? "").replace(/\s+/g, " ").trim();
    if (!title && titleAttr) title = decodeEntities(titleAttr).split(" - ")[0].trim();
    if (!title) continue;

    // Pris: köpknappens data-price är renast (heltal kronor) och bär valutan.
    // Slutsålda kort saknar köpknapp → fall tillbaka på span.amount.
    const dataPriceM = seg.match(/data-price="([0-9., ]+)"\s+data-currency="([A-Z]{3})"/);
    let priceOre: number | null = null;
    if (dataPriceM) {
      if (dataPriceM[2] !== "SEK") continue; // fel valuta → lita inte på något i kortet
      priceOre = parseSekPrice(dataPriceM[1]);
    }
    if (priceOre === null) {
      const amountM = seg.match(/<span class="amount">([0-9\s .,]+)<\/span>/);
      priceOre = amountM ? parseSekPrice(amountM[1]) : null;
    }
    if (!priceOre) continue;

    const stockText = seg.match(/<dd class="stock-status">([^<]*)<\/dd>/)?.[1]?.trim();
    const imgM = seg.match(/data-src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);

    out.push({
      url,
      title,
      priceOre,
      stock: starwebStockFromText(stockText),
      sku: seg.match(/data-sku="([^"]+)"/)?.[1],
      dataId: seg.match(/data-id="(\d+)"/)?.[1],
      imageUrl: imgM?.[1],
    });
  }
  return out;
}

export abstract class StarwebAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash — måste matcha ScrapeSource.baseUrl
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Kategorisidor att hämta (butikens egen stavning!). */
  protected abstract categoryPaths: string[];
  /**
   * Värd som produktlänkarna absolutiseras mot. Coolcards kanoniska värd är
   * www.coolcard.se (apex 301:ar dit) — länkar på apex hade gett en redirect på
   * varje klick och varje stock-verify-uppslag.
   */
  protected abstract canonicalBase: string;

  protected get idPrefix(): string {
    return this.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const path of this.categoryPaths) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = page === 1 ? `${this.baseUrl}${path}` : `${this.baseUrl}${path}?page=${page}`;
        let html: string;
        try {
          const res = await politeFetch(url, { delayMs: PAGE_DELAY_MS });
          if (!res.ok) {
            if (page === 1) errors.push(`${this.name}: HTTP ${res.status} ${url}`);
            break;
          }
          html = await res.text();
        } catch (err) {
          errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }

        const found = parseStarwebListing(html, this.canonicalBase);
        if (found.length === 0) break;
        let added = 0;
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          added++;
          products.push({
            externalId: item.dataId
              ? `${this.idPrefix}-${item.dataId}`
              : item.sku
                ? `${this.idPrefix}-${item.sku}`
                : `${this.idPrefix}-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
            title: item.title,
            url: item.url,
            price: item.priceOre,
            currency: "SEK",
            stockStatus:
              item.stock === "in"
                ? StockStatus.IN_STOCK
                : item.stock === "out"
                  ? StockStatus.OUT_OF_STOCK
                  : StockStatus.UNKNOWN,
            imageUrl: item.imageUrl,
            category: guessListingCategory(item.title),
            raw: {
              priceOre: item.priceOre,
              stock: item.stock,
              url: item.url,
              sku: item.sku,
            } satisfies StarwebRaw,
          });
        }
        // Sista sidan repeteras för höga ?page → inga NYA produkter = klart.
        if (added === 0) break;
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
    if (isStarwebRaw(raw)) {
      if (raw.stock === "in") return StockStatus.IN_STOCK;
      if (raw.stock === "out") return StockStatus.OUT_OF_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isStarwebRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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

// ---------- Konkreta butiker (Starweb) ----------

/**
 * Coolcard säljer även hockey-/fotbollskort — bara Pokémon-kategorin hämtas.
 * Gosedjuren i kategorin stoppas av isMerchandiseListing i runnern.
 */
export class CoolcardAdapter extends StarwebAdapter {
  name = "Coolcard";
  baseUrl = "https://coolcard.se";
  protected categoryPaths = ["/category/pokmon"];
  protected canonicalBase = "https://www.coolcard.se";
}
