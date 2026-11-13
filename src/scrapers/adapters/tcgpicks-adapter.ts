/**
 * TcgPicksAdapter — tcgpicks.com (TCG Picks, Skene).
 *
 * ⛔ OMBYGGD SAJT 2026-11 (upptäckt 2026-11-13: lanen fick 404 på varje hämtning, butiken var
 *    blind). Butiken var en vanlig Shopify-butik (`/products.json`, wholeCatalog); nu är den en
 *    egen React-app (TanStack Start) ovanpå Shopifys Storefront-API. `/products.json`,
 *    `/collections/*` och `/products/<handle>` svarar 404 — produktsidorna heter
 *    `/produkt/<handle>` (SAMMA handle som förut). robots.txt: `User-agent: * / Allow: /`.
 *
 * Datat ligger i den serverrenderade kollektionssidan: `/kollektion/sealed-produkter` bär
 * VARJE förseglad produkt i sidans inbäddade laddardata (54 st 2026-11-13, en hämtning —
 * sidan RITAR 48 och "Visa fler" visar resten ur samma data). Formen är Storefront-API:ts:
 *   {id:"gid://shopify/Product/<id>",title:"…",handle:"…",productType:"…",…,
 *    availableForSale:!0,…,priceRange:{minVariantPrice:{amount:"2199.0",currencyCode:"SEK"}},…}
 * serialiserad som JavaScript (inte JSON: `!0`/`!1`, `$R[n]=`-referenser) ⇒ fälten plockas
 * per produktblock med reguljära uttryck, aldrig med JSON.parse på hela sidan.
 *
 * FULLSTÄNDIGHET: sidan skriver själv "Visar N av M". Läser vi färre block än M är hämtningen
 * ett FEL (tom lista + fel ⇒ förra lagerläget behålls) — en halv lista hade fått resten att se
 * frånvarande ut.
 *
 * ⚠️ OMÄTT: hur en SLUTSÅLD vara ser ut. Vid proben var alla 54 `availableForSale: true` —
 *    antingen döljer butiken slutsålt ur kollektionen (⇒ frånvaro, som feed-diffen redan
 *    hanterar som "kolla, tolka inte") eller så står varan kvar med `!1` (⇒ OUT_OF_STOCK här).
 *    Båda vägarna är täckta; läs lanens logg vid butikens nästa utförsäljning.
 * ⛔ Ingen korglänk: den gamla `/cart/<variant>:1` finns inte på den nya sajten.
 * ⛔ Appens egna serverfunktioner (`/_serverFn/…`) används INTE — interna, byter namn per bygge.
 */
import { StockStatus, SourceType } from "@prisma/client";
import { politeFetch } from "../http";
import { normalizeTitle } from "../../lib/utils";
import type { AdapterResult, NormalizedProduct, RawProductData, SourceAdapter } from "../types";
import { guessListingCategory } from "../listing-category";

const BASE_URL = "https://tcgpicks.com";
/** Kollektioner som tillsammans bär allt förseglat. */
const COLLECTION_PATHS = ["/kollektion/sealed-produkter"];
const PAGE_DELAY_MS = 1500;

export interface TcgPicksItem {
  id: string;
  title: string;
  handle: string;
  available: boolean;
  priceOre: number | null;
  imageUrl?: string;
  /** Butikens egen språktagg ("lang:en" → "en"); null när produkten saknar en. */
  lang: string | null;
}

export interface TcgPicksRaw {
  productId: string;
  available: boolean;
  priceOre: number | null;
}

function isTcgPicksRaw(raw: unknown): raw is TcgPicksRaw {
  return typeof raw === "object" && raw !== null && "productId" in raw && "available" in raw && "priceOre" in raw;
}

/** En JS-strängliteral (utan citattecken) → text. Faller tillbaka på råtexten. */
function unescapeJs(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\(["\\/])/g, "$1");
  }
}

const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const field = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`\\b${name}:${STR}`));
  return m ? unescapeJs(m[1]) : null;
};

/**
 * Kollektionssidans HTML → produkterna i dess laddardata. Ren funktion — testad.
 * `expected` = talet M ur sidans "Visar N av M" (null när raden saknas).
 */
export function parseTcgPicksCollection(html: string): { items: TcgPicksItem[]; expected: number | null } {
  const items: TcgPicksItem[] = [];
  const seen = new Set<string>();
  const parts = html.split(/\{id:"gid:\/\/shopify\/Product\//).slice(1);
  for (const part of parts) {
    const id = part.match(/^(\d+)"/)?.[1];
    const title = field(part, "title")?.trim();
    const handle = field(part, "handle");
    // Produktens egen flagga står FÖRE variantlistan; första förekomsten är produktens.
    const avail = part.match(/\bavailableForSale:(!0|!1|true|false)/)?.[1];
    if (!id || !title || !handle || !avail || seen.has(id)) continue;
    seen.add(id);
    const amount = part.match(/minVariantPrice:(?:\$R\[\d+\]=)?\{amount:"([0-9.]+)",currencyCode:"SEK"/)?.[1];
    const kr = amount ? parseFloat(amount) : NaN;
    const image = part.match(new RegExp(`featuredImage:(?:\\$R\\[\\d+\\]=)?\\{url:${STR}`))?.[1];
    const tags = part.match(/\btags:(?:\$R\[\d+\]=)?\[([^\]]*)\]/)?.[1] ?? "";
    items.push({
      lang: tags.match(/"lang:([a-z-]+)"/i)?.[1].toLowerCase() ?? null,
      id,
      title,
      handle,
      available: avail === "!0" || avail === "true",
      // ⛔ 0 kr är en platshållare, inget pris — annonsen ska ändå med (price: null).
      priceOre: Number.isFinite(kr) && kr > 0 ? Math.round(kr * 100) : null,
      imageUrl: image ? unescapeJs(image) : undefined,
    });
  }
  // "Visar <!-- -->48<!-- --> av <!-- -->54" — kommentarerna är Reacts textgränser.
  const m = html.replace(/<!--.*?-->/g, "").match(/Visar\s*\d+\s*av\s*(\d+)/);
  return { items, expected: m ? parseInt(m[1], 10) : null };
}

/**
 * Annonsens titel med butikens språktagg utskriven. Titlarna bär sällan språket ("Inferno X
 * Booster Pack" är japansk enligt taggen `lang:ja`) och matchningen läser språk ur TITELN.
 * Kinesiska/koreanska ⇒ null (blockade språk, tas aldrig in). Ren funktion — testad.
 */
export function tcgPicksListingTitle(it: Pick<TcgPicksItem, "title" | "lang">): string | null {
  if (it.lang === "zh" || it.lang === "ko" || it.lang === "kr") return null;
  if (it.lang === "ja" && !/\b(jap\w*|jpn?)\b/i.test(it.title)) return `${it.title} (JP)`;
  return it.title;
}

export class TcgPicksAdapter implements SourceAdapter {
  name = "TCG Picks";
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = false;
  supportsStock = true;

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const seen = new Set<string>();
    try {
      for (const path of COLLECTION_PATHS) {
        const res = await politeFetch(`${BASE_URL}${path}`, { delayMs: PAGE_DELAY_MS });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
        const { items, expected } = parseTcgPicksCollection(await res.text());
        if (items.length === 0) throw new Error(`inga produkter i ${path} (sidan har bytt form?)`);
        if (expected !== null && items.length < expected) {
          throw new Error(`läste ${items.length} av ${expected} produkter i ${path}`);
        }
        for (const it of items) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          const title = tcgPicksListingTitle(it);
          if (!title) continue;
          const raw: TcgPicksRaw = { productId: it.id, available: it.available, priceOre: it.priceOre };
          products.push({
            // Samma id-form som Shopify-adaptern gav (`tcgpicks-<produkt-id>`).
            externalId: `tcgpicks-${it.id}`,
            title,
            url: `${BASE_URL}/produkt/${it.handle}`,
            price: it.priceOre,
            currency: "SEK",
            stockStatus: it.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
            imageUrl: it.imageUrl,
            category: guessListingCategory(title),
            raw,
          });
        }
      }
    } catch (err) {
      // ⛔ Ett fel ⇒ tom lista + fel, aldrig en halv (förra lagerläget behålls).
      return { products: [], errors: [`${this.name}: ${err instanceof Error ? err.message : String(err)}`] };
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
    if (isTcgPicksRaw(raw)) return raw.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isTcgPicksRaw(raw) && raw.priceOre !== null && raw.priceOre > 0) return { price: raw.priceOre, currency: "SEK" };
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
