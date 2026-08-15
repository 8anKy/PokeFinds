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
import { guessListingCategory } from "../listing-category";

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
 * Tak för live-koll av icke-i-lager-produkter per hämtning. 40 → 80 (2026-08-14):
 * feeden är nu 59 Pokémon-rader varav ~48 utan lager, så det gamla taket kapade TYST
 * de sista — och eftersom listan gås igenom i feed-ordning var det alltid SAMMA rader.
 * Ett tak under det verkliga antalet är precis den sortens tysta gräns som brister
 * först den dag den spelar roll (jfr MAX_COLLECTIONS 30→60). Kapning loggas nu.
 */
const LIVE_POLL_MAX = Math.max(1, Number(process.env.WEBHALLEN_LIVE_POLL_MAX ?? 80));
/**
 * Fördröjning mellan live-uppslagen mot samma värd. Egen konstant för att den är
 * lanens största latenspost — se rotationen nedan.
 */
const LIVE_POLL_DELAY_MS = Math.max(100, Number(process.env.WEBHALLEN_LIVE_POLL_DELAY_MS ?? 800));

/**
 * ROTATIONSMARKÖR för live-kollen (2026-08-15).
 *
 * ⛔ EN LÅNGSAM BUTIK SATTE TAKTEN FÖR ALLA 42. Live-kollen slår upp varje icke-i-lager-
 * produkt sekventiellt med 800 ms paus: 48 rader ≈ 38 s, och MÄTT 2026-08-15 tog hela
 * Webhallen-hämtningen 52,3 s medan hela svepet över 42 butiker tog 54,4 s. Discord-
 * lanens tick kan aldrig bli kortare än sitt svep, så "tick var 60:e sekund" var en
 * önskan — och den butik som satte golvet står för 0,4 restocks/dygn av 12,2.
 *
 * I LOOP-LÄGE (Discord-lanen kör många svep i samma process) behöver inte varje tick
 * kolla alla: markören går vidare, så tick 1 tar de första N, tick 2 nästa N osv. Varje
 * produkt kollas då var (antal/N):e tick i stället för varje. Med N=16 och 48 rader blir
 * det var tredje tick ≈ 3 min — fortfarande långt under de ~50 min sökindexet släpar,
 * vilket var hela skälet till live-kollen.
 *
 * ⛔ DEFAULTEN ÄR OFÖRÄNDRAD (80 = alla). Ett engångsjobb (scrape-all, restock-watch)
 *    kör EN hämtning per process och måste täcka allt; bara den loopande lanen sätter
 *    ner talet via env. Sänk det aldrig som global default.
 */
let livePollCursor = 0;

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
 * ⛔ ANVÄND INTE `discontinued` SOM LAGERSIGNAL — PRÖVAT OCH ÅTERSTÄLLT 2026-08-14.
 * Produkt-API:t har ett `discontinued`-fält (0 eller 2) och produktsidan kan visa
 * "Produkten har utgått … inte längre till salu". Det är frestande att låta det slå
 * lagersiffran. Det är FEL: `discontinued: 2` betyder att varan utgått ur SORTIMENTET
 * (inget mer kommer in), inte att den är osäljbar. Mätt på Mega Greninja ex Premium
 * Collection samma dag: `discontinued: 2` OCH `web: 1` OCH "Lägg i varukorg" +
 * "Webblager ✓ 1 st" på sidan, samtidigt. "Har utgått"-rutan visas först när en
 * utgången vara nått NOLL. En vakt på fältet stänger alltså av larm för sista
 * exemplaren av slutsålda produkter — precis de larm som är mest värda.
 *
 * `stock.web` är rätt fält för köpbarhet. Webhallen skickar FRÅN BUTIK, så en enhet i
 * en fysisk butik räknas som webblager och ÄR säljbar (`webStock["992"]`, det rena
 * webblagret, är 0 för fullt köpbara varor — använd inte heller det).
 */
export function webhallenStockStatus(item: WebhallenProduct): StockStatus {
  if ((item.stock?.web ?? 0) > 0) return StockStatus.IN_STOCK;
  const releaseTs = item.release?.timestamp;
  if (typeof releaseTs === "number" && releaseTs * 1000 > Date.now()) {
    return StockStatus.PREORDER;
  }
  return StockStatus.OUT_OF_STOCK;
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
            category: guessListingCategory(item.name),
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
      // Kandidaterna i feed-ordning, sedan ROTERADE med markören: i loop-läge tar
      // varje tick nästa skiva i stället för samma första N om och om igen.
      const candidates = products.filter((p) => p.stockStatus !== StockStatus.IN_STOCK);
      const start = candidates.length ? livePollCursor % candidates.length : 0;
      const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];
      livePollCursor = start + Math.min(LIVE_POLL_MAX, candidates.length);

      let polled = 0;
      let skippedByCap = 0;
      for (const p of ordered) {
        if (polled >= LIVE_POLL_MAX) {
          skippedByCap++;
          continue;
        }
        polled++;
        try {
          const raw = p.raw as WebhallenRaw;
          const res = await politeFetch(`${BASE_URL}/api/product/${raw.id}`, {
            delayMs: LIVE_POLL_DELAY_MS,
            headers: { accept: "application/json" },
          });
          if (!res.ok) continue;
          const detail = (await res.json()) as { product?: WebhallenProduct };
          if (!detail.product) continue;
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
      // console.warn och INTE `errors`: ett täckningshål är inget adapterfel och ska
      // inte dra igång butikshälso-larmen via errorCount i runScrapeJob.
      if (skippedByCap > 0) {
        console.warn(
          `[webhallen] Live-kollen kapades av LIVE_POLL_MAX (${LIVE_POLL_MAX}) — ` +
            `${skippedByCap} av ${candidates.length} produkter kollades INTE denna hämtning ` +
            `och deras lagerstatus kommer från det släpande sökindexet. I loop-läge tas de ` +
            `av nästa tick (rotationsmarkören står på ${livePollCursor % Math.max(1, candidates.length)}).`
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
