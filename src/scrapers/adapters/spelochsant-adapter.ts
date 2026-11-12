/**
 * SpelOchSantAdapter — spelochsant.se (Spel & Sånt), Pokémon TCG.
 *
 * Probad 2026-10-15. Egen PHP-butik med en Vue-listning. robots.txt svarar 200 med
 * TOM kropp (= allt tillåtet). SEK.
 *
 * Kategorisidan (`/kategori/pokemonkort`) renderar INGA produkter i HTML:en — listningen
 * (`ProductList`, chunk 603 i `/javascript/dist/`) hämtar dem med
 *   POST /products/json  (form: category, product_limit, limit_offset, sort_by, sort_order)
 * och svarar `{ success, num_products, products[] }`. Kategori 192 = "Pokemon Kort"
 * (alla underkategorier: lösa boosters, tins, färdiga lekar, övriga, tillbehör — även
 * produkter med platt slug utan kategoriväg ingår). Servern kapar `product_limit` vid 50
 * ⇒ sidor med `limit_offset` tills `num_products` är nått (122 st = 3 anrop vid proben).
 * ⛔ Sajtens sök (`/products/search?query=`, det `#search:pokemon` visar) kapar vid 150
 *    träffar och blandar in kläder/Switch-spel — används INTE. Kategorin täckte varje
 *    TCG-produkt söket hittade (diffat 2026-10-15).
 *
 * ⛔ SPRÅKET STYRS AV `Accept-Language`. Utan svensk header översätter butiken `name` till
 *    engelska — och översättningen är FEL ("30th Anniversary Booster Bundle" för butikens
 *    egen "30th Celebration Booster Bundle"). Vi skickar `sv-SE` och får originalnamnet.
 *
 * KNAPPEN DÖMER (samma läxa som Alphaspel/Card Haven: bara köpknappen vet), mätt över
 * Pokémon- och Switch 2-kategorierna:
 *   `class="button buy"`       "Lägg i varukorg" (grön, saldo > 0)    ⇒ IN_STOCK
 *   `class="button booking"`   "Förhandsboka"   (gul, "N bokningsbara") ⇒ PREORDER
 *   `class="button subscribe"` "Bevaka"         (röd, "Ej i lager" / "Fullbokad") ⇒ OUT_OF_STOCK
 *   annat                                                               ⇒ UNKNOWN
 * `stock.quantity` är ett riktigt saldo (37, 185 …) men kan vara -1 på en slutsåld vara —
 * det används bara som diagnostik, aldrig som dom.
 *
 * Produktsidan (`/produkt/<slug>`) bär JSON-LD med `availability` + GTIN ⇒ `json-ld` i
 * stock-verify. ⚠️ En borttagen produkt-URL svarar 200 med en generisk sida (ingen 404) —
 * då finns ingen Product-nod och verifieringen svarar null.
 *
 * ⛔ OMBYGGD SAJT 2026-11 (upptäckt 2026-11-12: lanen fick 404 på varje hämtning, butiken var
 *    blind). Butiken är nu en Nuxt-app mot ett eget API:
 *      POST https://api.spelochsant.se/bombrest/products/json
 *      JSON: { settings: { category, product_limit, limit_offset, sort_by, sort_order } }
 *      svar: { status, result: { success, num_products, products[] } }
 *    "Pokemon Kort" är kategori 242 (var 192; id:t står i kategorisidans `page-sections`-svar,
 *    `parent_id`). Produktsidorna ligger kvar på `/produkt/<slug>` ⇒ befintliga offers gäller.
 *    API-värdens robots.txt svarar 200 med tom kropp (= tillåtet).
 *    `buy_button` finns INTE längre i svaret — domen tas på lagerbrickan (`sosStockFromBadge`):
 *      `green_bomb` + saldo > 0 ("3 st i lager", "20+ i lager") ⇒ IN_STOCK
 *      `red_bomb` ("ej i lager")                                 ⇒ OUT_OF_STOCK
 *      "N bokningsbara" i texten                                 ⇒ PREORDER
 *      annat                                                     ⇒ UNKNOWN
 *    ⚠️ OMÄTT: ingen bokningsbar vara fanns vid proben (39 produkter: 12 gröna, 27 röda) —
 *       förhandsbokningens bricka är härledd ur den gamla sajtens text. Kontrollera mot sidans
 *       knapp vid nästa förhandsbokning (scripts/audit-preorder-claims.ts).
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

const BASE_URL = "https://www.spelochsant.se";
const LIST_URL = "https://api.spelochsant.se/bombrest/products/json";
const LIST_PATH = "/products/json";
/** "Pokemon Kort" i butikens kategoriträd (242 sedan ombygget 2026-11; var 192). */
const POKEMON_CATEGORY_ID = 242;
/** Serverns eget tak per anrop. */
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const PAGE_DELAY_MS = 1500;

export type SosStock = "in" | "preorder" | "out" | "unknown";

export interface SosRaw {
  priceOre: number | null;
  stock: SosStock;
  quantity: number | null;
  stockText: string;
  url: string;
  id: string;
}

function isSosRaw(raw: unknown): raw is SosRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "stock" in raw && "url" in raw;
}

/** `buy_button`-markupen → dom. Ren funktion — testad. */
export function sosStockFromButton(buttonHtml: string | null | undefined): SosStock {
  if (!buttonHtml) return "unknown";
  const cls = buttonHtml.match(/class="([^"]*)"/)?.[1] ?? "";
  if (!/\bbutton\b/.test(cls)) return "unknown";
  if (/\bbuy\b/.test(cls)) return "in";
  if (/\bbooking\b/.test(cls)) return "preorder";
  if (/\bsubscribe\b/.test(cls)) return "out";
  return "unknown";
}

/**
 * Lagerbrickan (`stock.class` + text + saldo) → dom, för API:t efter ombygget 2026-11 där
 * `buy_button` saknas. Ren funktion — testad.
 */
export function sosStockFromBadge(stock: SosApiProduct["stock"]): SosStock {
  if (!stock) return "unknown";
  const cls = String(stock.class ?? "");
  const text = String(stock.text ?? "").toLowerCase();
  const q = parseInt(String(stock.quantity ?? ""), 10);
  if (/bokningsbar/.test(text)) return "preorder";
  if (/\bred/.test(cls) || /ej i lager|fullbokad|slut/.test(text)) return "out";
  if (/\bgreen/.test(cls) && (/i lager/.test(text) || (Number.isFinite(q) && q > 0))) return "in";
  return "unknown";
}

/**
 * Köpgränsen i titeln — "(MAX 1 Per Hushåll)", "(MAX 6 Boosters Per Hushåll)",
 * "(MAX 1 Köp Per Hushåll)". Den delade skräplistan i matching.ts tar bara "max N per
 * kund/hushåll"; ord mellan talet och "per" lämnade resten kvar i titeln. Hela
 * parentesen bort när den börjar på MAX.
 */
export function cleanSosTitle(title: string): string {
  return title
    .replace(/\(\s*max\b[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SosApiProduct {
  id?: string | number;
  name?: string;
  price?: string | number;
  slug?: string;
  stock?: { class?: string; text?: string; quantity?: string | number } | null;
  buy_button?: string;
  big_image_url?: string;
  image_url?: string;
}

export interface SosItem {
  id: string;
  title: string;
  url: string;
  priceOre: number | null;
  stock: SosStock;
  quantity: number | null;
  stockText: string;
  imageUrl?: string;
}

/** Ett API-objekt → vår form. `null` när det saknar id/namn/slug. Ren — testad. */
export function parseSosProduct(p: SosApiProduct): SosItem | null {
  const id = p.id != null ? String(p.id) : "";
  const title = cleanSosTitle(String(p.name ?? ""));
  const slug = String(p.slug ?? "").replace(/^\/+/, "");
  if (!id || !title || !slug) return null;
  const priceKr = parseFloat(String(p.price ?? "").replace(",", "."));
  // ⛔ 0 kr är en platshållare, inget pris — men annonsen ska ändå med (price: null).
  const priceOre = Number.isFinite(priceKr) && priceKr > 0 ? Math.round(priceKr * 100) : null;
  const q = parseInt(String(p.stock?.quantity ?? ""), 10);
  const img = (p.big_image_url || p.image_url || "").replace(/(https?:\/\/[^/]+)\/\/+/, "$1/");
  return {
    id,
    title,
    url: `${BASE_URL}/produkt/${slug}`,
    priceOre,
    // Gamla svaret bar knappen; det nya bara lagerbrickan.
    stock: p.buy_button ? sosStockFromButton(p.buy_button) : sosStockFromBadge(p.stock),
    quantity: Number.isFinite(q) ? q : null,
    stockText: String(p.stock?.text ?? "").trim(),
    imageUrl: img || undefined,
  };
}

const STATUS_BY_STOCK: Record<SosStock, StockStatus> = {
  in: StockStatus.IN_STOCK,
  preorder: StockStatus.PREORDER,
  out: StockStatus.OUT_OF_STOCK,
  unknown: StockStatus.UNKNOWN,
};

interface SosPage {
  success?: boolean;
  num_products?: string | number;
  products?: SosApiProduct[];
}

export class SpelOchSantAdapter implements SourceAdapter {
  name = "Spel & Sånt";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  private async fetchPage(offset: number): Promise<SosPage> {
    const res = await politeFetch(LIST_URL, {
      delayMs: PAGE_DELAY_MS,
      method: "POST",
      body: JSON.stringify({
        settings: {
          sort_by: "received",
          sort_order: "desc",
          product_limit: PAGE_SIZE,
          category: POKEMON_CATEGORY_ID,
          limit_offset: offset > 0 ? offset : false,
          initial: offset === 0,
        },
      }),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "accept-language": "sv-SE,sv;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${LIST_PATH} (offset ${offset})`);
    const body = (await res.json()) as { result?: SosPage } & SosPage;
    const json: SosPage = body.result ?? body;
    if (json.success !== true || !Array.isArray(json.products)) {
      throw new Error(`oväntat svar från ${LIST_PATH} (offset ${offset})`);
    }
    return json;
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const seen = new Set<string>();
    let total: number | null = null;
    let fetched = 0;

    // ⛔ En sida som faller ⇒ hela hämtningen är ett fel. En halv lista hade fått
    // resten att se FRÅNVARANDE ut (samma regel som SF-Bok).
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const json = await this.fetchPage(page * PAGE_SIZE);
        if (total === null) total = parseInt(String(json.num_products ?? ""), 10);
        const batch = json.products ?? [];
        fetched += batch.length;
        for (const p of batch) {
          const item = parseSosProduct(p);
          if (!item || seen.has(item.id)) continue;
          seen.add(item.id);
          // Kategorin bär även tärningar/sleeves/askar utan Pokémon — de är inte vår vara.
          if (!/pok[eé]mon/i.test(item.title)) continue;
          const raw: SosRaw = {
            priceOre: item.priceOre,
            stock: item.stock,
            quantity: item.quantity,
            stockText: item.stockText,
            url: item.url,
            id: item.id,
          };
          products.push({
            externalId: `sos-${item.id}`,
            title: item.title,
            url: item.url,
            price: item.priceOre,
            currency: "SEK",
            stockStatus: STATUS_BY_STOCK[item.stock],
            imageUrl: item.imageUrl,
            category: guessListingCategory(item.title),
            raw,
          });
        }
        if (batch.length < PAGE_SIZE || (Number.isFinite(total) && fetched >= (total as number))) break;
      }
    } catch (err) {
      return { products: [], errors: [`${this.name}: ${err instanceof Error ? err.message : String(err)}`] };
    }

    if (total !== null && Number.isFinite(total) && fetched < total) {
      return {
        products: [],
        errors: [`${this.name}: läste ${fetched} av ${total} produkter (MAX_PAGES ${MAX_PAGES}) — höj taket.`],
      };
    }
    return { products, errors: [] };
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
    if (isSosRaw(raw)) return STATUS_BY_STOCK[raw.stock] ?? StockStatus.UNKNOWN;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isSosRaw(raw) && raw.priceOre !== null && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: raw.priceOre, currency: "SEK" };
    }
    return null;
  }

  validateResult(p: RawProductData): boolean {
    return (
      p.externalId.length > 0 &&
      p.title.trim().length > 0 &&
      (p.price === null || (Number.isInteger(p.price) && p.price > 0)) &&
      p.url.startsWith("http")
    );
  }
}
