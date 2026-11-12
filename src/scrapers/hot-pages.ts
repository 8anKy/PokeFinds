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
