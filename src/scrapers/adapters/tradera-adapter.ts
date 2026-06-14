/**
 * TraderaAdapter — hämtar Pokémon TCG-priser via Traderas OFFICIELLA API
 * (SearchService.Search, SOAP v3). Ingen HTML-skrapning.
 *
 * Auth: appId + appKey som query-parametrar (TRADERA_APP_ID / TRADERA_APP_KEY
 * i .env). Kvot: 100 Search-anrop per 24 h → budgeten per körning styrs av
 * TRADERA_MAX_SEARCH_CALLS (default 30, dvs. 3 körningar/dygn à 8 h ryms).
 *
 * Kategoriträd (Samlarsaker → Pokémonkort = 293307):
 *  - 1001337 Löskort/Singles
 *  - 1001338 Graderade kort (HOPPAS ÖVER — graderade får inte matcha raw)
 *  - 1001339 Boosterpaket (bundles listas ofta här)
 *  - 1001340 Boosterboxar
 *  - 1001341 Övrigt (ETB m.m.)
 *
 * Datakvalitet:
 *  - Endast aktiva fastpris-annonser (PureBuyItNow med BuyItNowPrice) tas med.
 *    Pågående auktioners "pris" är aktuellt bud (ofta 1 kr) och förorenar datat.
 *  - Annonser med språkattribut ≠ Engelska hoppas över (katalogen är EN).
 *  - Priser är hela kronor i API:t → öre = ×100.
 */
import { StockStatus, SourceType } from "@prisma/client";
import { normalizeTitle } from "../../lib/utils";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";

const BASE_URL = "https://www.tradera.com";
const API_URL = "https://api.tradera.com/v3/searchservice.asmx";

/** Tradera-kategorier att svepa (graderade kort 1001338 utelämnas medvetet). */
const CATEGORY_IDS: { id: number; label: string; fallbackCategory: string }[] = [
  { id: 1001340, label: "Boosterboxar", fallbackCategory: "BOOSTER_BOX" },
  { id: 1001339, label: "Boosterpaket", fallbackCategory: "BOOSTER_PACK" },
  { id: 1001341, label: "Övrigt sealed", fallbackCategory: "OTHER" },
  { id: 1001337, label: "Löskort/Singles", fallbackCategory: "SINGLE_CARD" },
];

/** API:t returnerar 50 annonser per sida. */
const PAGE_SIZE = 50;

const DEFAULT_MAX_CALLS = 30;
const CALL_DELAY_MS = 1000;

interface TraderaApiItem {
  itemId: string;
  title: string;
  /** Fast pris i öre. */
  priceOre: number;
  url: string;
  imageUrl?: string;
  itemType: string;
  isEnded: boolean;
  hasBids: boolean;
  endDate?: string;
  sellerAlias?: string;
  categoryId?: number;
  /** Traderas attribut "pokemon_language", t.ex. "Engelska". */
  language?: string;
  /** Traderas attribut "condition", t.ex. "Oanvänt". */
  condition?: string;
  source: "tradera-api";
}

function isTraderaApiItem(raw: unknown): raw is TraderaApiItem {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "itemId" in raw &&
    "priceOre" in raw &&
    (raw as TraderaApiItem).source === "tradera-api"
  );
}

/** Avkodar XML-entiteter i textvärden. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Textinnehållet i första <name>...</name> i blocket, eller undefined. */
function tagText(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  if (!m) return undefined;
  const v = decodeEntities(m[1].trim());
  return v.length > 0 ? v : undefined;
}

/**
 * Värden för ett namngivet term-attribut (t.ex. pokemon_language) ur ett
 * item-block. Tolerant mot exakt elementstruktur: tar alla textnoder mellan
 * <Name>{attr}</Name> och närmaste </TermAttributeValues>.
 */
function termAttributeValues(block: string, attrName: string): string[] {
  const m = block.match(
    new RegExp(`<Name>${attrName}</Name>([\\s\\S]*?)</TermAttributeValues>`)
  );
  if (!m) return [];
  return [...m[1].matchAll(/>([^<>]+)</g)]
    .map((x) => decodeEntities(x[1].trim()))
    .filter((v) => v.length > 0);
}

/** Bygger SOAP-envelope för SearchService.Search. */
function buildSearchEnvelope(query: string, categoryId: number, pageNumber: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Search xmlns="http://api.tradera.com">
      <query>${query}</query>
      <categoryId>${categoryId}</categoryId>
      <pageNumber>${pageNumber}</pageNumber>
      <orderBy>Relevance</orderBy>
    </Search>
  </soap:Body>
</soap:Envelope>`;
}

/** Tolkar ett <Items>-block till ett item, eller null om obrukbart. */
function parseItem(block: string): TraderaApiItem | null {
  const itemId = tagText(block, "Id");
  const title = tagText(block, "ShortDescription");
  if (!itemId || !title) return null;

  // BuyItNowPrice är hela kronor; nillable (självstängande tagg matchas ej).
  const binText = tagText(block, "BuyItNowPrice");
  const bin = binText ? parseInt(binText, 10) : NaN;
  if (!Number.isFinite(bin) || bin <= 0) return null;

  const rawUrl = tagText(block, "ItemUrl");
  const url = rawUrl
    ? rawUrl.replace(/^http:\/\//, "https://")
    : `${BASE_URL}/item/0/${itemId}/`;

  const categoryIdText = tagText(block, "CategoryId");

  return {
    itemId,
    title,
    priceOre: bin * 100,
    url,
    imageUrl: tagText(block, "ThumbnailLink"),
    itemType: tagText(block, "ItemType") ?? "",
    isEnded: tagText(block, "IsEnded") === "true",
    hasBids: tagText(block, "HasBids") === "true",
    endDate: tagText(block, "EndDate"),
    sellerAlias: tagText(block, "SellerAlias"),
    categoryId: categoryIdText ? parseInt(categoryIdText, 10) : undefined,
    language: termAttributeValues(block, "pokemon_language")[0],
    condition: termAttributeValues(block, "condition")[0],
    source: "tradera-api",
  };
}

/** Grov produktkategori utifrån annonstiteln (matchas mot Product.category). */
function guessCategory(title: string, fallback: string): string {
  const lower = title.toLowerCase();
  if (/psa|bgs|cgc|\bgrad/i.test(lower)) return "GRADED_CARD";
  if (/booster\s*(box|display)|boosterbox|display/i.test(lower)) return "BOOSTER_BOX";
  if (/elite\s*trainer|\betb\b/i.test(lower)) return "ETB";
  if (/booster\s*bundle/i.test(lower)) return "BUNDLE";
  if (/booster\s*pack|boosterpaket|booster\b/i.test(lower)) return "BOOSTER_PACK";
  if (/collection\s*box|premium\s*collection/i.test(lower)) return "COLLECTION_BOX";
  if (/tin\b/i.test(lower)) return "TIN";
  if (/blister/i.test(lower)) return "BLISTER";
  if (/bundle/i.test(lower)) return "BUNDLE";
  if (/\b(?:ex|gx|vmax|vstar|v\b|alt\s*art|full\s*art|secret|rainbow|gold)\b/i.test(lower))
    return "SINGLE_CARD";
  return fallback;
}

export class TraderaAdapter implements SourceAdapter {
  name = "Tradera";
  // SCRAPER behålls som typ för kompatibilitet med befintlig ScrapeSource-rad,
  // men datakällan är Traderas officiella SOAP-API.
  type: SourceType = SourceType.SCRAPER;
  baseUrl = BASE_URL;
  supportsSearch = true;
  supportsStock = true;

  private async search(
    query: string,
    categoryId: number,
    pageNumber: number,
    appId: string,
    appKey: string
  ): Promise<string> {
    const res = await fetch(`${API_URL}?appId=${appId}&appKey=${appKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"http://api.tradera.com/Search"',
      },
      body: buildSearchEnvelope(query, categoryId, pageNumber),
    });
    if (!res.ok) {
      throw new Error(`Tradera API HTTP ${res.status} (kategori ${categoryId}, sida ${pageNumber})`);
    }
    return res.text();
  }

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];

    const appId = process.env.TRADERA_APP_ID;
    const appKey = process.env.TRADERA_APP_KEY;
    if (!appId || !appKey) {
      return {
        products,
        errors: ["TRADERA_APP_ID/TRADERA_APP_KEY saknas i miljön — hoppar över Tradera."],
      };
    }

    const maxCalls = Math.max(
      1,
      parseInt(process.env.TRADERA_MAX_SEARCH_CALLS ?? "", 10) || DEFAULT_MAX_CALLS
    );
    // Fördela budgeten jämnt över kategorierna; resterande anrop får
    // singel-kategorin (störst utbud).
    const perCategory = Math.max(1, Math.floor(maxCalls / CATEGORY_IDS.length));

    let callsUsed = 0;
    const seen = new Set<string>();

    for (const { id: categoryId, label, fallbackCategory } of CATEGORY_IDS) {
      const categoryBudget = Math.min(perCategory, maxCalls - callsUsed);
      if (categoryBudget <= 0) break;

      try {
        let totalPages = 1;
        for (let page = 1; page <= categoryBudget && page <= totalPages; page++) {
          if (callsUsed >= maxCalls) break;
          if (callsUsed > 0) await new Promise((r) => setTimeout(r, CALL_DELAY_MS));
          callsUsed++;

          const xml = await this.search("pokemon", categoryId, page, appId, appKey);

          const pagesText = xml.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
          if (pagesText) totalPages = parseInt(pagesText[1], 10);

          const blocks = [...xml.matchAll(/<Items>([\s\S]*?)<\/Items>/g)].map((m) => m[1]);
          if (blocks.length === 0) break;

          for (const block of blocks) {
            const item = parseItem(block);
            if (!item) continue;
            if (seen.has(item.itemId)) continue;
            seen.add(item.itemId);

            // Endast aktiva, rena fastpris-annonser. Auktioner (även med
            // köp nu-pris) hoppar vi över när de redan fått bud, eftersom
            // de oftast slutar över köp nu-priset eller dras tillbaka.
            if (item.isEnded) continue;
            if (item.itemType !== "PureBuyItNow" && item.hasBids) continue;

            // Språkvakt: katalogen är engelskspråkig. Annonser som uttryckligen
            // anger annat språk hoppas över (matching.ts fångar även titlar).
            if (item.language && !/^eng/i.test(item.language)) continue;

            products.push({
              externalId: `tradera-${item.itemId}`,
              title: item.title,
              url: item.url,
              price: item.priceOre,
              currency: "SEK",
              stockStatus: StockStatus.IN_STOCK,
              imageUrl: item.imageUrl,
              category: guessCategory(item.title, fallbackCategory),
              raw: item,
            });
          }
        }
      } catch (err) {
        errors.push(
          `Tradera-kategori ${label} (${categoryId}): ${err instanceof Error ? err.message : err}`
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
    if (isTraderaApiItem(raw)) {
      return raw.isEnded ? StockStatus.OUT_OF_STOCK : StockStatus.IN_STOCK;
    }
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isTraderaApiItem(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
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
