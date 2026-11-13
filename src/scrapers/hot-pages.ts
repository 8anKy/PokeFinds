/**
 * HETA SIDOR — en paginerad butikskategori där bara NÅGRA sidor behöver vara färska (2026-11-12).
 *
 * MaxGamings 30th UPC släpptes 14:00 och sålde slut mellan två av lanens hämtningar (hela
 * kategorin = 6 sidor ⇒ en hämtning per 60 s); en konkurrent postade direkt, vi först vid
 * nästa våg 14:32. Butikens artighetstak är förfrågningar per sekund, inte hämtningar — så
 * i stället för att läsa ALLA sidor var 60:e sekund läser lanen de HETA sidorna (sida 1 +
 * sidorna som bär det vi nyss postat om, dvs varor som fylls på i vågor) var ~12:e sekund
 * och hela kategorin ungefär en gång i minuten. Samma last, 5× färskare där det brinner.
 *
 * ⛔ FEEDEN ÄR ALLTID KOMPLETT: en het hämtning ger de färska sidorna + resten ur förra
 *    fulla hämtningen. Lanens diff får aldrig se en halv katalog (frånvaro = ingen
 *    information), och en vara som bytt sida mellan två fulla hämtningar bärs kvar.
 * ⛔ BARA I LOOP-LÄGE: påslaget med env (`<BUTIK>_HOT_FULL_EVERY`) som sätts ENBART i
 *    discord-restock.yml. Nattkedjan kör en hämtning per process och läser alltid allt.
 * Minnet är per process (modulnivå) — adaptrarna skapas om för varje hämtning.
 */

const hot = new Map<string, Set<string>>();

/** Lanen talar om vilka butiks-URL:er som är heta just nu (det den postat senaste dygnet). */
export function setHotUrls(store: string, urls: Iterable<string>): void {
  hot.set(store, new Set(urls));
}

export function hotUrlsFor(store: string): ReadonlySet<string> {
  return hot.get(store) ?? new Set();
}

const warm = new Map<string, Set<string>>();

/** Butikens övriga varor i HETA SET (lanen postat om setet, i någon butik) — kollas efter de heta. */
export function setWarmUrls(store: string, urls: Iterable<string>): void {
  warm.set(store, new Set(urls));
}

export function warmUrlsFor(store: string): ReadonlySet<string> {
  return warm.get(store) ?? new Set();
}

/**
 * LIVE-SVAR FRÅN PRODUKTSIDAN (2026-11-13). MaxGamings 30th UPC: en annan server postade 14:28,
 * vi 14:32 — lanen hämtade kategorin varje minut däremellan och såg "Slutsåld" fyra gånger.
 * Kategorilistan SLÄPAR alltså minuter efter produktsidan (samma sak som Webhallens sökindex).
 * Adaptern frågar därför produktsidan för de heta varor som listan kallar slut, och svaret
 * läggs OVANPÅ listan så länge det är färskt — annars hade varan pendlat lista/sida varje varv.
 */
const live = new Map<string, Map<string, { stock: string; at: number }>>();
export const LIVE_TTL_MS = 10 * 60_000;

export function setLiveStock(store: string, url: string, stock: string, at = Date.now()): void {
  const m = live.get(store) ?? new Map();
  m.set(url, { stock, at });
  live.set(store, m);
}

/** Färskt live-svar för URL:en, eller null. */
export function liveStockFor(store: string, url: string, now = Date.now()): string | null {
  const e = live.get(store)?.get(url);
  if (!e) return null;
  if (now - e.at > LIVE_TTL_MS) {
    live.get(store)?.delete(url);
    return null;
  }
  return e.stock;
}

const cursors = new Map<string, number>();

/**
 * Vilka produktsidor ska frågas det här varvet? Heta först, sedan varma; bara de som listan
 * INTE kallar "i lager" (eller där ett live-svar säger emot listan — de hålls färska).
 * Roterar, så alla kandidater får sin tur.
 */
export function pickLiveChecks(
  store: string,
  items: { url: string; inStock: boolean }[],
  max: number,
  now = Date.now()
): string[] {
  if (max <= 0) return [];
  const byUrl = new Map(items.map((it) => [it.url, it]));
  const wants = (u: string) => {
    const it = byUrl.get(u);
    if (!it) return false;
    const l = liveStockFor(store, u, now);
    return !it.inStock || (l != null && l !== "in");
  };
  const tier = (set: ReadonlySet<string>, key: string, n: number): string[] => {
    const list = [...set].filter(wants);
    if (!list.length || n <= 0) return [];
    const start = (cursors.get(key) ?? 0) % list.length;
    const out: string[] = [];
    for (let i = 0; i < Math.min(n, list.length); i++) out.push(list[(start + i) % list.length]);
    cursors.set(key, start + out.length);
    return out;
  };
  const first = tier(hotUrlsFor(store), `${store}#hot`, max);
  const rest = tier(new Set([...warmUrlsFor(store)].filter((u) => !hotUrlsFor(store).has(u))), `${store}#warm`, max - first.length);
  return [...first, ...rest];
}

interface CacheEntry<T> {
  /** Sidnyckel (hämtnings-URL) → sidans varor, i hämtningsordning. */
  pages: Map<string, T[]>;
  /** Heta hämtningar sedan senaste fulla. */
  sinceFull: number;
}

const caches = new Map<string, CacheEntry<{ url: string }>>();

/** Nollställer minnet (tester). */
export function resetHotPages(): void {
  hot.clear();
  warm.clear();
  live.clear();
  cursors.clear();
  caches.clear();
}

export interface HotPlan {
  /** Sidnycklar att hämta om. `null` = full hämtning. */
  pages: string[] | null;
}

/**
 * Vad ska den här hämtningen läsa? Full när läget är av, när inget minne finns eller var
 * `fullEvery`:e gång; annars första sidan + de sidor som bär flest heta URL:er.
 */
export function planHotFetch(store: string, fullEvery: number, maxPages = 3): HotPlan {
  const cache = caches.get(store);
  if (!(fullEvery > 1) || !cache || cache.pages.size === 0) return { pages: null };
  if (cache.sinceFull >= fullEvery - 1) return { pages: null };
  const urls = hotUrlsFor(store);
  const keys = [...cache.pages.keys()];
  const first = keys[0];
  const ranked = keys
    .slice(1)
    .map((k) => ({ k, n: (cache.pages.get(k) ?? []).filter((it) => urls.has(it.url)).length }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((p) => p.k);
  return { pages: [first, ...ranked].slice(0, Math.max(1, maxPages)) };
}

/** En lyckad FULL hämtning: ersätter minnet. */
export function commitFullFetch<T extends { url: string }>(store: string, pages: Map<string, T[]>): void {
  caches.set(store, { pages: new Map(pages), sinceFull: 0 });
}

/**
 * En lyckad HET hämtning: de färska sidorna ersätter sina platser, och hela katalogen
 * returneras (färskt först vid dubblett). En vara som fallit av en färsk sida utan att
 * synas på en annan färsk bärs kvar med sitt gamla besked tills nästa fulla hämtning.
 */
export function commitHotFetch<T extends { url: string }>(store: string, fresh: Map<string, T[]>): T[] {
  const cache = caches.get(store) as CacheEntry<T> | undefined;
  if (!cache) return [...fresh.values()].flat();
  const freshUrls = new Set<string>();
  for (const items of fresh.values()) for (const it of items) freshUrls.add(it.url);
  for (const [key, items] of fresh) {
    const carried = (cache.pages.get(key) ?? []).filter((it) => !freshUrls.has(it.url));
    cache.pages.set(key, [...items, ...carried]);
  }
  cache.sinceFull++;
  const out: T[] = [];
  const seen = new Set<string>();
  // Färska sidor först, så en vara som flyttat till en färsk sida får det färska beskedet.
  const order = [...fresh.keys(), ...[...cache.pages.keys()].filter((k) => !fresh.has(k))];
  for (const key of order) {
    for (const it of cache.pages.get(key) ?? []) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      out.push(it);
    }
  }
  return out;
}

/** `<NAMN>_HOT_FULL_EVERY` → heltal > 1, annars 0 (läget av). */
export function hotFullEvery(envName: string): number {
  const n = parseInt(process.env[envName] ?? "", 10);
  return Number.isFinite(n) && n > 1 ? n : 0;
}
