/**
 * MaxGamingAdapter — restock-/prisadapter för MaxGaming.se (svensk gaming-butik
 * med ett rikt Pokémon TCG-sealedsortiment). Hämtar den server-renderade
 * Pokémon-kategorin och extraherar titel/pris/lager/URL ur produktkorten.
 *
 * Upptäckt (2026-06-15): kategorin /sv/pokemon listar 60 produkter/sida och
 * paginerar via ?page=N. Varje produktkort:
 *   <div class="PT_Wrapper"><div class="pt_inner …">
 *     <a class="PT_Lank" href="https://www.maxgaming.se/sv/pokemon/{slug}" title="Titel"></a>
 *     … <span data-artnr="34492" …> …
 *     <span class="PT_PrisNormal">399 kr</span>
 *     <div class="PT_text_Lagerstatus Lager_{N}_SV">I lager | Tillfälligt slut | Slutsåld</div>
 * Lagerkoder: Lager_1_SV = "I lager" (IN_STOCK); allt annat (2 = Tillfälligt
 * slut, 10 = Slutsåld) = OUT_OF_STOCK.
 *
 * robots.txt (verifierad 2026-06-15): tillåter /sv/pokemon (endast /cgi-bin/,
 * /webbadmin och /sok är Disallow). ETIK: politeFetch (robots.txt, delay,
 * FoilioBot UA, backoff). Inga inloggningar/captcha/personuppgifter.
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

const MAX_PAGES = 10; // ~597 pokemon-artiklar / 60 per sida → täcker hela kategorin
const PAGE_DELAY_MS = 1000;

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
  const cleaned = text.replace(/[\s ]/g, "").replace(/kr|sek/gi, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/booster\s*(box|display)/.test(t)) return "BOOSTER_BOX";
  if (/elite\s*trainer|\betb\b/.test(t)) return "ETB";
  if (/booster\s*bundle/.test(t)) return "BUNDLE";
  if (/booster\s*pack|\bbooster\b/.test(t)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/.test(t)) return "COLLECTION_BOX";
  if (/\btin\b/.test(t)) return "TIN";
  if (/blister/.test(t)) return "BLISTER";
  if (/bundle/.test(t)) return "BUNDLE";
  return "OTHER";
}

interface MaxRaw {
  title: string;
  priceOre: number;
  url: string;
  inStock: boolean;
  artnr?: string;
}
function isMaxRaw(raw: unknown): raw is MaxRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "inStock" in raw;
}

export class MaxGamingAdapter implements SourceAdapter {
  name = "MaxGaming";
  baseUrl = "https://www.maxgaming.se";
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  protected parseProducts(html: string): MaxRaw[] {
    const out: MaxRaw[] = [];
    // Dela på produktwrappern. Varje segment = ett produktkort (länk, pris, lager).
    const cards = html.split(/class="PT_Wrapper"/);
    for (let i = 1; i < cards.length; i++) {
      const card = cards[i].slice(0, 8000); // bunden mot pathologisk backtracking
      const linkM = card.match(/class="PT_Lank"\s+href="([^"]+)"\s+title="([^"]*)"/);
      if (!linkM) continue;
      // href är relativ på live-sajten (/sv/…) → bygg absolut URL.
      const href = decodeEntities(linkM[1]).split("#")[0].split("?")[0];
      const url = /^https?:\/\//.test(href)
        ? href
        : `${this.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      const title = decodeEntities(linkM[2]).replace(/\s+/g, " ").trim();
      if (!/^https?:\/\/[^/]*maxgaming\.se\/sv\//.test(url) || !title) continue;
      const priceM = card.match(/class="PT_PrisNormal"[^>]*>\s*([0-9][0-9\s .,]*)\s*kr/i);
      if (!priceM) continue;
      const priceOre = parseSekPrice(priceM[1]);
      if (!priceOre) continue;
      const lagerM = card.match(/class="PT_text_Lagerstatus\s+Lager_(\d+)_SV"/);
      const inStock = lagerM ? lagerM[1] === "1" : /I lager/i.test(card);
      const artnr = card.match(/data-artnr="(\d+)"/)?.[1];
      out.push({ title, priceOre, url, inStock, artnr });
    }
    return out;
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = page === 1 ? `${this.baseUrl}/sv/pokemon` : `${this.baseUrl}/sv/pokemon?page=${page}`;
        const res = await politeFetch(url, { delayMs: PAGE_DELAY_MS });
        if (!res.ok) {
          if (page === 1) errors.push(`${this.name}: HTTP ${res.status} ${url}`);
          break;
        }
        const html = await res.text();
        const found = this.parseProducts(html);
        if (found.length === 0) break;
        let added = 0;
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          added++;
          products.push({
            externalId: item.artnr ? `maxgaming-${item.artnr}` : `maxgaming-${Buffer.from(item.url).toString("base64url").slice(0, 40)}`,
            title: item.title,
            url: item.url,
            price: item.priceOre,
            currency: "SEK",
            stockStatus: item.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
            category: guessCategory(item.title),
            raw: item,
          });
        }
        if (added === 0) break; // ingen ny produkt → sista sidan (paginering tog slut)
      }
    } catch (err) {
      errors.push(`${this.name}: ${err instanceof Error ? err.message : String(err)}`);
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
    if (isMaxRaw(raw)) return raw.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isMaxRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
