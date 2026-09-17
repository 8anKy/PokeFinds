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
 * Lagerkoder (mätt 2026-09-17 över 204 kort): Lager_1 = "I lager" (IN_STOCK),
 * Lager_8 = "Förhandsboka" (PREORDER — produktsidan har en AKTIV Förhandsboka-knapp),
 * Lager_2 = "Tillfälligt slut", Lager_10 = "Slutsåld", Lager_12 = "Kommer snart"
 * (OUT_OF_STOCK — ingen köpknapp alls). Gridet bär inga knappar, så koden ÄR domen.
 * ⛔ Lager_8 låg som OUT fram till 2026-09-17: samma miss som Alphaspels Boka-knapp —
 * en öppen förhandsbokning är KÖPBAR och lanen postar OUT→PREORDER som "preorder-open".
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
import { nordiskCartUrl } from "@/lib/cart-url";
import { guessListingCategory } from "../listing-category";

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


type MaxStock = "in" | "preorder" | "out";

/**
 * Lagerkod → dom. Okänd kod faller tillbaka på texten i samma div (allowlist:
 * "förhandsboka" → preorder, "i lager" → in, annars out — hellre ur lager än falskt köpbar).
 */
export function maxgamingStock(lagerCode: string | null, text: string): MaxStock {
  if (lagerCode === "1") return "in";
  if (lagerCode === "8") return "preorder";
  if (lagerCode === "2" || lagerCode === "10" || lagerCode === "12") return "out";
  const t = text.toLowerCase();
  if (/förhandsbok|forhandsbok/.test(t)) return "preorder";
  if (/i lager/.test(t)) return "in";
  return "out";
}

const STATUS_BY_STOCK: Record<MaxStock, StockStatus> = {
  in: StockStatus.IN_STOCK,
  preorder: StockStatus.PREORDER,
  out: StockStatus.OUT_OF_STOCK,
};

interface MaxRaw {
  title: string;
  priceOre: number;
  url: string;
  /** Kvar för gamla rawData-rader (före 2026-09-17); nya rader bär `stock`. */
  inStock: boolean;
  stock?: MaxStock;
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
      const lagerM = card.match(/class="PT_text_Lagerstatus\s+Lager_(\d+)_SV"[^>]*>([\s\S]*?)<\//);
      const stock = maxgamingStock(lagerM?.[1] ?? null, lagerM?.[2] ?? card);
      const artnr = card.match(/data-artnr="(\d+)"/)?.[1];
      out.push({ title, priceOre, url, inStock: stock === "in", stock, artnr });
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
          // ⛔ ÄVEN EN SIDA MITT I PAGINERINGEN ÄR ETT FEL. Rapporterades bara sida 1 förut,
          // och ett `break` på sida 2 gav en tyst AVKLIPPT katalog: de nyaste produkterna
          // ligger först, men allt därefter försvann utan spår. En avklippt katalog får
          // aldrig se ut som en komplett — anroparen loggar errors (se fetchSourceFeed).
          errors.push(`${this.name}: HTTP ${res.status} ${url} (sida ${page} av max ${MAX_PAGES})`);
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
            stockStatus: STATUS_BY_STOCK[item.stock ?? (item.inStock ? "in" : "out")],
            // Korgen tar bara POST hos Nordisk e-handel ⇒ länken går via vår brygga
            // (/api/go/korg). Samma `artnr` som externalId; saknas det finns ingen länk.
            cartUrl: nordiskCartUrl(this.baseUrl, item.artnr),
            category: guessListingCategory(item.title),
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
    if (isMaxRaw(raw)) return STATUS_BY_STOCK[raw.stock ?? (raw.inStock ? "in" : "out")];
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
      p.price !== null && // okänt pris släpps BARA igenom av Shopify (types.ts) — här krävs ett tal
      Number.isInteger(p.price) &&
      p.price > 0 &&
      p.url.startsWith("http")
    );
  }
}
