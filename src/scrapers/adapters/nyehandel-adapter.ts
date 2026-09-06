/**
 * NyehandelAdapter — adapter för butiker på **Nyehandel** (svensk e-com-plattform,
 * server-renderad kategori-HTML, CDN `nycdn.nyehandel.se`). Byggd för Sweet Nerds;
 * basklassen är återanvändbar om fler Nyehandel-butiker dyker upp.
 *
 * Upptäckt (probe 2026-09-06 mot sweetnerds.se):
 *   · Kategorin /sv/categories/pokemon-tcg är FÖRÄLDERN till butikens fyra
 *     Pokémon-kategorier (pokemon-eng, pokemon-jpch, pokemon-30th-celebration,
 *     singlespromos) + tillbehör — 206 produkter, 25/sida, ?page=1..9.
 *     ⛔ Hämta INTE barnkategorierna också: samma produkt hade räknats flera gånger
 *        och kostat fyra gånger så många hämtningar för exakt samma feed.
 *   · Varje produktkort (mätt: 56 av 56 kort bär ALLA fyra fälten):
 *       <div class="product-card">
 *         <a class="product-card__image" href="https://…/sv/products/{slug}">
 *         <span class="brand">Pokémon TCG</span>
 *         <span class="name">Titel</span>
 *         <div class="price has-comparison">
 *           <del class="comparison">599 kr</del>      ← tidigare pris (REA)
 *           <ins id="product-price">499 kr</ins>      ← gällande pris
 *         <div class="product-card-inventory-status … stock_status_N"> Finns i lager </div>
 *         <div class="product-card-available-stock"> 33 Styck </div>
 *         <favorite-button product-id="100">          ← stabilt id, finns på ALLA kort
 *
 * ⛔ `stock_status_N`-KLASSEN ÄR INTE LAGERSTATUS. Mätt: `stock_status_1` bär BÅDE
 *    "Finns i lager" OCH "Förbeställningsvara" — den är butikens lagerPOLICY, inte
 *    lagerläget. Domen tas på TEXTEN (se `nyehandelStockFromText`).
 *
 * ⛔ PRISET ÄR `<ins>`, ALDRIG `<del>`. På ett reakort står det gamla priset FÖRST i
 *    HTML:en; en girig "första kr-träffen"-regex hade rapporterat 599 kr när butiken
 *    tar 499 kr — ett för högt pris gör att produkten aldrig ser ut som ett fynd, och
 *    prisfallslarmet hade larmat om en sänkning som redan var gjord.
 *
 * ⛔ KÖPKNAPPENS `data-id` DUGER INTE SOM externalId — slutsålda kort har ingen
 *    köpknapp (de får en "Bevaka"-länk i stället). `favorite-button[product-id]`
 *    finns på varje kort oavsett lagerläge.
 *
 * robots.txt (verifierad 2026-09-06): `Disallow: /api/`, `/frontend-api/`, `/admin/`,
 * `/account/`, `/apps/`, `/activate`, `/offline/`, `/change-locale/`, `/*?filters`
 * och `/*?sort`. Kategorisidor och `?page=N` är TILLÅTNA — vi rör alltså varken
 * butikens interna API eller de filtrerade vyerna. ⛔ Sortera aldrig feeden via
 * `?sort=` (t.ex. "in-stock"): det är uttryckligen förbjudet i robots.txt.
 *
 * ETIK: politeFetch (robots.txt, per-host-delay, FoilioBot UA, backoff). Inga
 * inloggningar, ingen captcha, inga personuppgifter.
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

/** 9 sidor uppmätta 2026-09-06 (206 produkter) — 20 ger gott om växtutrymme. */
const MAX_PAGES = 20;
const PAGE_DELAY_MS = 1500;
/** Bunden segmentlängd per produktkort — mot patologisk backtracking. */
const ITEM_SLICE = 9_000;

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

export type NyehandelStock = "in" | "out" | "preorder" | "unknown";

export interface NyehandelItem {
  url: string;
  title: string;
  /** Öre, > 0 — eller `null` = pris okänt (butikens 0 kr-platshållare). Aldrig 0. */
  priceOre: number | null;
  stock: NyehandelStock;
  productId?: string;
  imageUrl?: string;
  /** Butikens egna "N Styck" — bara som NEDGRADERING, se parseNyehandelListing. */
  quantity?: number;
}

interface NyehandelRaw {
  priceOre: number | null;
  stock: NyehandelStock;
  url: string;
  productId?: string;
}
function isNyehandelRaw(raw: unknown): raw is NyehandelRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw;
}

/**
 * Lagertext → dom. ALLOWLIST, precis som Alphaspel: köpbar BARA när butiken
 * uttryckligen skriver att varan finns. Allt okänt blir `unknown`, aldrig `in` —
 * ett falskt "i lager" skickar ett larm som leder användaren till en slutsåld sida,
 * och det är dyrare än ett larm vi missar.
 *
 * Mätt vokabulär 2026-09-06 (56 kort): "Finns i lager", "Slut på lager",
 * "Förbeställningsvara".
 */
export function nyehandelStockFromText(text: string | undefined): NyehandelStock {
  if (!text) return "unknown";
  const t = text.toLowerCase();
  // Förbeställning FÖRE lagerregeln: "Förbeställningsvara" innehåller inte "lager",
  // men ordningen skyddar mot framtida fraser som "förbeställning – i lager 12 sep".
  if (/förbest|forbest|pre-?order/.test(t)) return "preorder";
  if (/slut|utsåld|utsald/.test(t)) return "out";
  if (/finns i lager|i lager/.test(t)) return "in";
  return "unknown";
}

/**
 * Plockar produktkorten ur en Nyehandel-kategorisida. Ren funktion → testbar utan nät.
 */
export function parseNyehandelListing(html: string): NyehandelItem[] {
  const out: NyehandelItem[] = [];
  const segments = html.split(/class="product-card"/).slice(1);

  for (const rawSeg of segments) {
    const seg = rawSeg.slice(0, ITEM_SLICE);

    const hrefM = seg.match(/href="(https?:\/\/[^"]*\/products\/[^"#?]+)"/);
    if (!hrefM) continue;
    const url = decodeEntities(hrefM[1]);

    const nameM = seg.match(/<span class="name">([\s\S]*?)<\/span>/);
    if (!nameM) continue;
    const title = decodeEntities(nameM[1]).replace(/\s+/g, " ").trim();
    if (!title) continue;

    // ⛔ Gällande pris = <ins>. <del class="comparison"> är det ÖVERSTRUKNA priset.
    const priceM = seg.match(/<ins[^>]*id="product-price"[^>]*>([^<]+)<\/ins>/);
    if (!priceM) continue;
    // Avkoda FÖRE parsning — butiken separerar tusental med `&nbsp;` ("1&nbsp;299 kr").
    const priceText = decodeEntities(priceM[1]).trim();
    // Valutavakt: butiken skriver "kr". Något annat = lita inte på kortet alls.
    if (!/kr$/i.test(priceText)) continue;
    // ⛔ 0 KR ÄR EN PLATSHÅLLARE, INTE ETT PRIS — OCH FÅR INTE SLÄNGA ANNONSEN.
    // Exakt samma fälla som Shopify 2026-09-04, ny plattform: butiken sätter 0 kr på
    // OSLÄPPTA produkter. Mätt här 2026-09-06: 15 av 206 annonser, varav **9 är 30th
    // Celebration** — dvs precis de osläppta varor folk bevakar. En `continue` här
    // hade tappat inte priset utan HELA annonsen: ingen feedpost, ingen StoreListing,
    // ingen auto-import, aldrig ett larm. `null` = "pris okänt" (se types.ts):
    // annonsen överlever som länk + lagerstatus, och får ingen PriceObservation.
    const priceOre = parseSekPrice(priceText); // null vid 0 kr / ogiltigt

    const statusM = seg.match(/product-card-inventory-status[^>]*>([\s\S]*?)<\/div>/);
    const statusText = statusM
      ? decodeEntities(statusM[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      : undefined;
    let stock = nyehandelStockFromText(statusText);

    // "N Styck" används BARA för att nedgradera, aldrig för att uppgradera: butiken
    // kan mycket väl sälja en förbeställning med saldo 0, men en vara med saldo 0 som
    // påstår "Finns i lager" är en motsägelse och ska inte larma.
    const qtyM = seg.match(/product-card-available-stock[^>]*>([\s\S]*?)<\/div>/);
    const qtyText = qtyM ? qtyM[1].replace(/<[^>]+>/g, " ") : undefined;
    const qtyNum = qtyText?.match(/(-?\d+)\s*styck/i);
    const quantity = qtyNum ? parseInt(qtyNum[1], 10) : undefined;
    if (stock === "in" && quantity !== undefined && quantity <= 0) stock = "out";

    const imgM = seg.match(/src="(https?:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i);

    out.push({
      url,
      title,
      priceOre,
      stock,
      productId: seg.match(/favorite-button[^>]*product-id="(\d+)"/)?.[1],
      imageUrl: imgM ? decodeEntities(imgM[1]) : undefined,
      quantity,
    });
  }
  return out;
}

export abstract class NyehandelAdapter implements SourceAdapter {
  abstract name: string;
  abstract baseUrl: string; // utan avslutande slash — måste matcha ScrapeSource.baseUrl
  type: SourceType = SourceType.SCRAPER;
  supportsSearch = false;
  supportsStock = true;

  /** Kategorisidor att hämta (butikens egen stavning!). */
  protected abstract categoryPaths: string[];

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

        const found = parseNyehandelListing(html);
        if (found.length === 0) break;

        let added = 0;
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          added++;
          products.push({
            externalId: item.productId
              ? `${this.idPrefix}-${item.productId}`
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
                  : item.stock === "preorder"
                    ? StockStatus.PREORDER
                    : StockStatus.UNKNOWN,
            imageUrl: item.imageUrl,
            category: guessListingCategory(item.title),
            raw: {
              priceOre: item.priceOre,
              stock: item.stock,
              url: item.url,
              productId: item.productId,
            } satisfies NyehandelRaw,
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
    if (isNyehandelRaw(raw)) {
      if (raw.stock === "in") return StockStatus.IN_STOCK;
      if (raw.stock === "out") return StockStatus.OUT_OF_STOCK;
      if (raw.stock === "preorder") return StockStatus.PREORDER;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    // null = ingen prisobservation — 0 kr-platshållaren är inte ett pris.
    if (isNyehandelRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      // null = pris okänt och GODKÄNT (butikens 0 kr-platshållare på osläppta varor);
      // ett TAL måste fortfarande vara ett positivt heltal i öre. Samma regel som
      // ShopifyAdapter sedan 2026-09-04.
      (p.price === null || (Number.isInteger(p.price) && p.price > 0)) &&
      p.url.startsWith("http")
    );
  }
}

// ---------- Konkreta butiker (Nyehandel) ----------

/**
 * Sweet Nerds (Bromölla) säljer godis/läsk vid sidan av TCG — bara Pokémon-kategorin
 * hämtas. Kategorin rymmer även singlar och tillbehör; de fälls av vaktkedjan i
 * runnern (isSingleCardListing / isAccessoryListing), inte här.
 */
export class SweetNerdsAdapter extends NyehandelAdapter {
  name = "Sweet Nerds";
  baseUrl = "https://sweetnerds.se";
  protected categoryPaths = ["/sv/categories/pokemon-tcg"];
}
