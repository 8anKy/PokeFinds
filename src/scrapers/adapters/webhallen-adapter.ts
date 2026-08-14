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
// 5 → 8 (2026-08-13): sökningen är nu 7 sidor (157 träffar à 24). Sidorna 6–7 var
// bara Ultra Pro-tillbehör vid mätningen, men ett tak under sidantalet är en tyst
// gräns som brister först den dag ett riktigt TCG-släpp hamnar där.
const MAX_PAGES = 8;
/**
 * Tak för live-koll per hämtning. 40 → 80 (2026-08-14): feeden är nu 59 Pokémon-rader
 * (48 utan lager + 11 med), så det gamla taket kapade TYST de sista ~19 — och eftersom
 * listan gås igenom i feed-ordning var det alltid SAMMA rader som aldrig kollades.
 * Ett tak under det verkliga antalet är precis den sortens tysta gräns som brister
 * först den dag den spelar roll (jfr MAX_COLLECTIONS 30→60, 2026-08-13). Kapning
 * loggas numera som en VARNING i stället för att bara hända.
 */
const LIVE_POLL_MAX = 80;

/**
 * Utgått-markören per produkt-id, cachad i PROCESSEN.
 *
 * `discontinued` är en KATALOGEGENSKAP — den ändras kanske en gång i en produkts liv —
 * till skillnad från lagersiffran, som är hela skälet att live-kollen finns. Discord-
 * lanen loopar ~5 tick per jobb, så utan cache hade varje vara i lager slagits upp på
 * nytt var 60:e sekund för ett svar som aldrig ändras. Med cachen betalas de uppslagen
 * en gång per jobb i stället för en gång per tick.
 *
 * Medvetet i minnet och inte i Actions-cachen: en ny process hämtar om den, vilket är
 * rätt sorts fel (färsk data, marginell kostnad). TTL:n finns för den sällsynta vägen
 * tillbaka — Webhallen kan återuppta en utgången vara, och då ska vi märka det.
 */
const DISCONTINUED_TTL_MS = 60 * 60 * 1000;
const discontinuedCache = new Map<number, { discontinued: boolean; at: number }>();

function searchUrl(page: number): string {
  return `${BASE_URL}/api/productdiscovery/search/${encodeURIComponent(SEARCH_QUERY)}?page=${page}&touchpoint=DESKTOP&totalProductCountSet=true`;
}

interface WebhallenProduct {
  id: number;
  name: string;
  price: { price: string; currency: string } | null;
  stock?: { web?: number | null } | null;
  regularPrice?: { price: string };
  /** Unix-tidsstämpel (sekunder) för lanseringsdatum. Framtida datum = förhandsbokning. */
  release?: { timestamp?: number | null } | null;
  /**
   * Webhallens EGEN utgått-markör ("Produkten har utgått … inte längre till salu då den
   * har utgått ur sortimentet"). Uppmätt värderymd 2026-08-14 över 120 produkter i fyra
   * kategorier: bara 0 (103) och 2 (17) — ingen tvetydig mellannivå. Läses därför som
   * boolean.
   *
   * ⛔ FINNS BARA I PRODUKT-API:t (/api/product/{id}). Sök-API:ts rader saknar fältet
   * HELT — det är hela skälet att live-kollen nedan måste omfatta även varor som
   * sökfeeden påstår finns i lager.
   */
  discontinued?: number | null;
  /** T.ex. "Leksaker & Hobby/Samlarkortspel/Pokémon" */
  categoryTree?: string | null;
  thumbnail?: string;
}

interface WebhallenRaw {
  id: number;
  name: string;
  priceOre: number;
  url: string;
  stockStatus: StockStatus;
  imageUrl?: string;
  rawProduct: WebhallenProduct;
}

function isWebhallenRaw(raw: unknown): raw is WebhallenRaw {
  return typeof raw === "object" && raw !== null && "priceOre" in raw && "id" in raw;
}

/**
 * Webhallen säljer slut-lager (web>0), utgångna (web=0, släppt) och FÖRHANDSBOKNING
 * (web=0 men lanseringsdatum i framtiden — köpbar nu, levereras vid release). De två
 * senare ser identiska ut i lagerfältet; bara `release`-datumet skiljer dem åt.
 *
 * ⛔ UTGÅTT SLÅR LAGERSIFFRAN (2026-08-14). Mega Greninja ex Premium Collection stod på
 * `web: 1` medan produktsidan sa "Produkten har utgått ur sortimentet" — den sista
 * enheten låg i FYSISK BUTIK 14 (`webStock` = {14: 1, 992: 0}). Utan den här raden
 * rapporterar vi en vara som inte går att köpa som "i lager", om och om igen.
 *
 * ⚠️ `stock.web` ÄR RÄTT FÄLT FÖR KÖPBARHET — det är bara utgått den inte känner till.
 * Webhallen skickar FRÅN BUTIK (Pitch Black Booster Bundle är fullt köpbar med
 * webblagret `992: 0`), så en enhet i en fysisk butik är normalt säljbar. Läs alltså
 * inte det här som "butikslager räknas inte".
 *
 * ⛔ ANVÄND INTE `webStock["992"]` SOM ERSÄTTNING — det var den uppenbara reflexen och
 * den är MÄTT FEL i båda riktningarna: Pitch Black Booster Bundle är fullt köpbar med
 * `992: 0` (falskt slutsåld), och den utgångna 9-pocket-pärmen har `992: 3` (falskt i
 * lager). `discontinued` är det enda fält som faktiskt svarar på frågan; `isShippable`,
 * `isCollectable` och `possibleDeliveryMethods` är IDENTISKA för utgångna varor.
 */
export function webhallenStockStatus(item: WebhallenProduct): StockStatus {
  if (item.discontinued) return StockStatus.OUT_OF_STOCK;
  if ((item.stock?.web ?? 0) > 0) return StockStatus.IN_STOCK;
  const releaseTs = item.release?.timestamp;
  if (typeof releaseTs === "number" && releaseTs * 1000 > Date.now()) {
    return StockStatus.PREORDER;
  }
  return StockStatus.OUT_OF_STOCK;
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

          const stockStatus = webhallenStockStatus(item);
          const productUrl = `${BASE_URL}/se/product/${item.id}`;

          const raw: WebhallenRaw = {
            id: item.id,
            name: item.name,
            priceOre,
            url: productUrl,
            stockStatus,
            imageUrl: item.thumbnail,
            rawProduct: item,
          };

          products.push({
            externalId: `webhallen-${item.id}`,
            title: item.name,
            url: productUrl,
            price: priceOre,
            currency: "SEK",
            stockStatus,
            imageUrl: item.thumbnail,
            category: guessCategory(item.name),
            raw,
          });
        }

        // Sista sidan upprepar ofta tidigare produkter — stoppa när inget nytt kommer
        if (newOnPage === 0) break;
      }

      // LIVE-KOLL AV RESTOCK-KANDIDATER (2026-08-10): sök-API:ts lagerfält SLÄPAR —
      // uppmätt: Pitch Black ETB blev köpbar ~11:48 UTC men sök-feeden visade flippen
      // först 12:38, så fem gröna 10-minuterskörningar missade den och larmet kom
      // ~50 min sent. Produkt-API:t (/api/product/{id}) är live — samma endpoint och
      // samma dom (webhallenStockStatus) som stock-verify redan litar på. Slå därför
      // upp varje icke-i-lager-produkt direkt och låt DET svaret gälla.
      // Bara icke-IN med flit: restocken är OOS/PREORDER → IN och det är den som ska
      // fångas snabbt; en stale "i lager" i sökindexet är ofarlig (rättas nästa flip,
      // och IN→OUT larmar aldrig). Cappad + politeFetch-delay av artighet mot butiken.
      // ⛔ ÄVEN RADER SÖKFEEDEN KALLAR "I LAGER" (2026-08-14). Förr hoppade loopen över
      // dem (`if IN_STOCK continue`) — men utgått-markören finns BARA i produkt-API:t,
      // så en utgången vara som ändå bär ett lagersaldo kunde aldrig avslöjas: exakt
      // Mega Greninja-fallet. Rader i lager behöver dock bara markören, inte en färsk
      // lagersiffra, så de svarar oftast ur cachen; rader UTAN lager slås upp varje
      // gång, för där är latensen hela poängen.
      let polled = 0;
      let skippedByCap = 0;
      const now = Date.now();
      for (const p of products) {
        const raw = p.raw as WebhallenRaw;
        const inStock = p.stockStatus === StockStatus.IN_STOCK;

        if (inStock) {
          const hit = discontinuedCache.get(raw.id);
          if (hit && now - hit.at < DISCONTINUED_TTL_MS) {
            if (hit.discontinued) {
              p.stockStatus = StockStatus.OUT_OF_STOCK;
              raw.stockStatus = StockStatus.OUT_OF_STOCK;
            }
            continue;
          }
        }

        if (polled >= LIVE_POLL_MAX) {
          skippedByCap++;
          continue;
        }
        polled++;
        try {
          const res = await politeFetch(`${BASE_URL}/api/product/${raw.id}`, {
            delayMs: 800,
            headers: { accept: "application/json" },
          });
          if (!res.ok) continue;
          const detail = (await res.json()) as { product?: WebhallenProduct };
          if (!detail.product) continue;
          discontinuedCache.set(raw.id, {
            discontinued: Boolean(detail.product.discontinued),
            at: Date.now(),
          });
          const live = webhallenStockStatus(detail.product);
          if (live !== p.stockStatus) {
            p.stockStatus = live;
            raw.stockStatus = live;
            raw.rawProduct = detail.product;
          }
        } catch {
          /* best effort — sök-feedens status står kvar, precis som före live-kollen */
        }
      }
      // Tysta tak är roten till täckningshål — samma regel som Shopifys kollektionstak.
      // Syns den här raden i loggen ska LIVE_POLL_MAX höjas. Medvetet console.warn och
      // INTE `errors`: en kapning är ett täckningshål, inte ett adapterfel, och
      // errorCount i runScrapeJob driver butikshälso-larmen.
      if (skippedByCap > 0) {
        console.warn(
          `[webhallen] Live-kollen kapades av LIVE_POLL_MAX (${LIVE_POLL_MAX}) — ` +
            `${skippedByCap} produkter kollades INTE: deras lagerstatus kommer från det ` +
            `släpande sökindexet och deras utgått-markör är okänd.`
        );
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
    if (isWebhallenRaw(raw)) return raw.stockStatus;
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
