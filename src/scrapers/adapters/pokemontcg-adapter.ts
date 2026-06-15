/**
 * PokemonTcgAdapter — officiellt Pokémon TCG API (https://api.pokemontcg.io/v2).
 *
 * Detta är en RIKTIG datakälla via officiellt, gratis API (ingen scraping):
 *  - Fungerar utan nyckel (lägre rate limit). Sätt POKEMONTCG_API_KEY i .env
 *    för högre gränser (gratis nyckel via https://dev.pokemontcg.io).
 *  - All trafik går via politeFetch (robots.txt, FoilioBot-UA, backoff).
 *  - Cardmarket-priser är i EUR → konverteras till öre med live-kurs från
 *    src/lib/exchange-rate (Frankfurter, cachad per dygn). TCGplayer-priser är
 *    i USD och används som fallback. Anropa getRatesOre() i början av en
 *    körning; pris-funktionerna läser sedan kursen synkront via
 *    getCachedRatesOre().
 *
 * Används av scripts/import-tcg-data.ts (katalogimport: sets + kort + bilder
 * + marknadspriser) och kan köras som SourceAdapter (SourceType.API) för
 * löpande prisobservationer.
 */
import { StockStatus, SourceType } from "@prisma/client";
// Relativa imports (inte "@/") så att filen även kan köras direkt via tsx
// i scripts/import-tcg-data.ts utan alias-konfiguration.
import { politeFetch } from "../http";
import { normalizeTitle } from "../../lib/utils";
import { getRatesOre, getCachedRatesOre } from "../../lib/exchange-rate";
import type {
  AdapterResult,
  NormalizedProduct,
  RawProductData,
  SourceAdapter,
} from "../types";

export const POKEMONTCG_API_BASE = "https://api.pokemontcg.io/v2";

/** Max sidstorlek som API:t tillåter. */
export const TCG_PAGE_SIZE = 250;

// ---------- API-typer (delmängd av svaret vi använder) ----------

export interface TcgSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate?: string; // "2023/03/31"
  images?: { symbol?: string; logo?: string };
}

export interface TcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  artist?: string;
  set: { id: string; name: string };
  images?: { small?: string; large?: string };
  cardmarket?: {
    url?: string;
    prices?: {
      trendPrice?: number;
      averageSellPrice?: number;
      avg7?: number;
      lowPrice?: number;
    };
  };
  tcgplayer?: {
    url?: string;
    prices?: Record<
      string,
      { market?: number; mid?: number; low?: number; high?: number }
    >;
  };
}

interface TcgListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key = process.env.POKEMONTCG_API_KEY;
  if (key) headers["X-Api-Key"] = key;
  return headers;
}

/**
 * Hämtar JSON från API:t via politeFetch (UA, robots, per-host-delay,
 * exponentiell backoff på 429/5xx).
 */
async function fetchTcgJson<T>(path: string): Promise<T> {
  const res = await politeFetch(`${POKEMONTCG_API_BASE}${path}`, {
    headers: apiHeaders(),
    // API:t tål tätare anrop än butiks-sajter; 600 ms räcker artigt.
    delayMs: 600,
    retries: 4,
  });
  if (!res.ok) {
    throw new Error(`Pokémon TCG API svarade HTTP ${res.status} för ${path}`);
  }
  return (await res.json()) as T;
}

/**
 * Hämtar set (sorterat på releasedatum, nyast först).
 * limit=0 → alla set (paginerat).
 */
export async function fetchTcgSets(limit = 0): Promise<TcgSet[]> {
  const select = "id,name,series,printedTotal,total,releaseDate,images";
  const all: TcgSet[] = [];
  let page = 1;
  const pageSize = TCG_PAGE_SIZE;

  while (true) {
    const json = await fetchTcgJson<TcgListResponse<TcgSet>>(
      `/sets?orderBy=-releaseDate&page=${page}&pageSize=${pageSize}&select=${select}`
    );
    all.push(...json.data);

    // Om vi har en gräns och nått den, sluta
    if (limit > 0 && all.length >= limit) {
      return all.slice(0, limit);
    }
    // Ingen mer data
    if (json.data.length < pageSize || all.length >= json.totalCount) break;
    page++;
  }
  return all;
}

/**
 * Hämtar kort för ett set, paginerat (pageSize max 250).
 *
 * OBS: använd INTE orderBy=number här. API:ts string-sortering på `number`
 * ger instabil paginering (kort hamnar mellan sidorna och tappas) — set med
 * >250 kort blev ofullständiga (t.ex. me2pt5 saknade #281). Utan orderBy är
 * pagineringen stabil och alla `totalCount` kort hämtas. Vi dedupar på id för
 * säkerhets skull och sorterar själva på nummer efteråt.
 */
export async function fetchTcgCardsForSet(
  setId: string,
  maxCards = TCG_PAGE_SIZE
): Promise<TcgCard[]> {
  const select =
    "id,name,number,rarity,supertype,subtypes,artist,set,images,cardmarket,tcgplayer";
  const byId = new Map<string, TcgCard>();
  let page = 1;
  while (byId.size < maxCards) {
    const pageSize = Math.min(TCG_PAGE_SIZE, maxCards - byId.size);
    const json = await fetchTcgJson<TcgListResponse<TcgCard>>(
      `/cards?q=set.id:${encodeURIComponent(setId)}&page=${page}&pageSize=${pageSize}&select=${select}`
    );
    for (const c of json.data) byId.set(c.id, c);
    if (json.data.length < pageSize || byId.size >= json.totalCount) break;
    page++;
  }
  const cards = [...byId.values()];
  cards.sort(
    (a, b) =>
      (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0) ||
      a.number.localeCompare(b.number)
  );
  return cards;
}

/** "2023/03/31" → Date (API:t använder snedstreck). */
export function parseTcgDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(/\//g, "-"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Marknadspris i öre för ett kort: Cardmarket trend (EUR) i första hand,
 * därefter Cardmarket snittförsäljning, sist TCGplayer market (USD).
 */
export function cardMarketPriceOre(card: TcgCard): number | null {
  const { eurToOre, usdToOre } = getCachedRatesOre();
  const cm = card.cardmarket?.prices;
  const eur = cm?.trendPrice ?? cm?.avg7 ?? cm?.averageSellPrice;
  if (eur && eur > 0) return Math.round(eur * eurToOre);

  const tp = card.tcgplayer?.prices;
  if (tp) {
    for (const variant of Object.values(tp)) {
      const usd = variant?.market ?? variant?.mid;
      if (usd && usd > 0) return Math.round(usd * usdToOre);
    }
  }
  return null;
}

// ---------- SourceAdapter-implementation ----------

interface TcgRaw {
  cardId: string;
  cardmarket?: TcgCard["cardmarket"];
  tcgplayer?: TcgCard["tcgplayer"];
  priceOre: number;
}

function isTcgRaw(raw: unknown): raw is TcgRaw {
  return (
    typeof raw === "object" && raw !== null && "cardId" in raw && "priceOre" in raw
  );
}

export class PokemonTcgAdapter implements SourceAdapter {
  name = "Pokémon TCG API";
  type: SourceType = SourceType.API;
  baseUrl = POKEMONTCG_API_BASE;
  supportsSearch = true;
  supportsStock = false;

  /** Antal senaste set vars kort hämtas vid en körning. */
  private setLimit = Number(process.env.TCG_ADAPTER_SET_LIMIT ?? 3);

  async fetchProducts(): Promise<AdapterResult> {
    const products: RawProductData[] = [];
    const errors: string[] = [];
    // Färsk EUR/USD-kurs en gång per körning → pris-funktionerna läser den
    // synkront via getCachedRatesOre().
    await getRatesOre();
    try {
      const sets = await fetchTcgSets(this.setLimit);
      for (const set of sets) {
        try {
          const cards = await fetchTcgCardsForSet(set.id);
          for (const card of cards) {
            const priceOre = cardMarketPriceOre(card);
            if (!priceOre) continue; // utan marknadspris → ingen observation
            const raw: TcgRaw = {
              cardId: card.id,
              cardmarket: card.cardmarket,
              tcgplayer: card.tcgplayer,
              priceOre,
            };
            products.push({
              externalId: card.id,
              title: `${card.name} · ${set.name} ${card.number}`,
              url: card.cardmarket?.url ?? `${this.baseUrl}/cards/${card.id}`,
              price: priceOre, // Cardmarket-trend → prishistorik/graf
              offerPrice: priceOre, // visat singelpris = Cardmarket-trend (marknadspris)
              currency: "SEK",
              stockStatus: StockStatus.UNKNOWN, // API:t saknar lagerdata
              imageUrl: card.images?.large ?? card.images?.small,
              category: "SINGLE_CARD",
              raw,
            });
          }
        } catch (err) {
          errors.push(
            `Kunde inte hämta kort för set ${set.id}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    } catch (err) {
      errors.push(
        `Kunde inte hämta sets: ${err instanceof Error ? err.message : err}`
      );
    }
    return { products, errors };
  }

  normalizeProduct(raw: RawProductData): NormalizedProduct {
    return {
      normalizedTitle: normalizeTitle(raw.title),
      price: raw.price,
      offerPrice: raw.offerPrice,
      currency: raw.currency,
      stockStatus: raw.stockStatus,
      url: raw.url,
      imageUrl: raw.imageUrl,
      category: raw.category,
    };
  }

  detectStockStatus(): StockStatus {
    return StockStatus.UNKNOWN;
  }

  extractPrice(raw: unknown): { price: number; currency: string } | null {
    if (isTcgRaw(raw) && Number.isFinite(raw.priceOre) && raw.priceOre > 0) {
      return { price: Math.round(raw.priceOre), currency: "SEK" };
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
