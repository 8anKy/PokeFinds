/**
 * SÖKHISTORIK + SENAST VISADE (2026-10-25, designpasset: "när man trycker i sökfältet
 * visas de senaste sökningarna").
 *
 * ⛔ BARA PÅ ENHETEN (localStorage), aldrig i databasen: en sökhistorik är personlig
 * och ett DB-anrop per sökning hade kostat en Neon-väckning för något som bara den här
 * telefonen behöver. HIG: "if you do show search history, provide a way for people to
 * clear it" — därav `clearRecentSearches`.
 * ⛔ Varje läsning/skrivning i try/catch: privat läge, blockerad lagring eller full
 * kvot ger ett undantag — och då ska sökfältet fungera som om historiken vore tom.
 * Nycklarna bär `foilio:` med flit (lagringsnycklarna behölls vid namnbytet).
 */

const SEARCHES_KEY = "foilio:recent-searches:v1";
const VIEWED_KEY = "foilio:recently-viewed:v1";
export const MAX_RECENT_SEARCHES = 8;
export const MAX_RECENTLY_VIEWED = 12;

export interface ViewedProduct {
  slug: string;
  title: string;
  imageUrl: string | null;
  /** öre, eller null när priset saknas */
  price: number | null;
}

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Lagringen är full/blockerad — historiken är en bekvämlighet, inget att larma om.
  }
}

/** Senaste först, en rad per sökning (skiftlägesokänsligt), högst MAX_RECENT_SEARCHES. */
export function addRecentSearch(list: string[], query: string): string[] {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return list;
  const key = q.toLowerCase();
  return [q, ...list.filter((s) => s.toLowerCase() !== key)].slice(0, MAX_RECENT_SEARCHES);
}

/** Senaste först, en rad per produkt, högst MAX_RECENTLY_VIEWED. */
export function addViewedProduct(list: ViewedProduct[], product: ViewedProduct): ViewedProduct[] {
  return [product, ...list.filter((p) => p.slug !== product.slug)].slice(0, MAX_RECENTLY_VIEWED);
}

export function loadRecentSearches(): string[] {
  return read<unknown>(SEARCHES_KEY).filter((s): s is string => typeof s === "string");
}

export function rememberSearch(query: string): void {
  write(SEARCHES_KEY, addRecentSearch(loadRecentSearches(), query));
}

export function forgetSearch(query: string): string[] {
  const key = query.toLowerCase();
  const next = loadRecentSearches().filter((s) => s.toLowerCase() !== key);
  write(SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches(): void {
  write<string>(SEARCHES_KEY, []);
}

export function loadRecentlyViewed(): ViewedProduct[] {
  return read<ViewedProduct>(VIEWED_KEY).filter(
    (p) => p && typeof p.slug === "string" && typeof p.title === "string"
  );
}

export function rememberViewed(product: ViewedProduct): void {
  write(VIEWED_KEY, addViewedProduct(loadRecentlyViewed(), product));
}
