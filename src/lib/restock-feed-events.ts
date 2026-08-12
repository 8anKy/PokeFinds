/**
 * Vilka lagerövergångar i en feed-hämtning som ska bli DISCORD-INLÄGG — helt utan DB.
 *
 * Ren funktion. All kunskap som normalt kommer ur databasen skickas in:
 *  - `prev` (förra körningens lagerläge) och `history` (övergångar i dygnsfönstret)
 *    ligger i Actions-cachen i stället för i RestockEvent-tabellen,
 *  - `routes` (butiks-URL → vår produkt/set/serie) exporteras en gång per dygn av ett
 *    jobb som ändå väcker Neon, så den här lanen aldrig behöver göra det.
 *
 * ⛔ TRE REGLER SOM MÅSTE SPEGLA DB-VÄGEN, annars driver lanarna isär tyst:
 *  1. Blink/flapp döms av `evaluateStockFlap` — SAMMA funktion som checkRestockAlerts,
 *     inte en kopia (därför bor den i @/lib/stock-flap sedan 2026-08-11).
 *  2. Cooldown per (butik, URL) precis som DB-vägens per (produkt, butik).
 *  3. Tom feed = ingen information. `mergeStateMap` äger den regeln; anropa den,
 *     bygg aldrig state ur bara den här körningens feed. Att missa det kostade
 *     23 % → 84 % vaken Neon-tid i juli 2026.
 *
 * ⛔ OKÄND URL POSTAS INTE. En URL som saknas i ruttabellen kan vara vad som helst —
 * sleeves, en singel, en figur — och DB-vägens vakter (`ensureListingProduct` med
 * isAccessoryListing/isSingleCardListing/isMerchandiseListing) finns inte här. En
 * publik kanal som postar plastfickor lär medlemmarna att ignorera den. Nya SKU:er
 * dyker upp i Discord när ruttabellen uppdateras (≤24 h); mejl och app larmar om dem
 * direkt via 10-min-lanen som har vakterna.
 */
import { actionableChanges, mergeStateMap, type FeedStateMap } from "@/lib/feed-state-diff";
import { evaluateStockFlap, FLAP_WINDOW_HOURS, type FlapPolicy } from "@/lib/stock-flap";
import type { RestockPost } from "@/lib/discord-restock";
import type { StockStatus } from "@prisma/client";

/** Feed-annonsen med allt inlägget behöver (superset av FeedItemLite). */
export interface FeedItemFull {
  url: string;
  stockStatus: StockStatus;
  title: string;
  price: number | null;
  imageUrl: string | null;
}

export interface FullFeedGroup {
  sourceName: string;
  items: FeedItemFull[];
}

/** En rad i ruttabellen: vad butikens URL är hos OSS. */
export interface RouteEntry {
  title: string;
  slug: string;
  setName: string | null;
  series: string | null;
}

export type RouteTable = Record<string, RouteEntry>;

/** En övergång i dygnsfönstret. Kompakta nycklar — kartan ligger i en cache-fil. */
export interface HistoryEntry {
  /** oldStatus */
  o: string;
  /** tidpunkt, ms */
  t: number;
}

export interface DiscordRestockState {
  /** url-nyckel → lagerstatus, exakt formatet feed-state-diff redan använder. */
  stock: FeedStateMap;
  /** url-nyckel → övergångar, nyast först, beskuren till dygnsfönstret. */
  history: Record<string, HistoryEntry[]>;
  /** url-nyckel → när vi senast POSTADE om den (cooldown). */
  posted: Record<string, number>;
}

export function emptyState(): DiscordRestockState {
  return { stock: {}, history: {}, posted: {} };
}

export interface DeriveOptions {
  state: DiscordRestockState | null;
  groups: FullFeedGroup[];
  rotating: Set<string>;
  routes: RouteTable;
  now: Date;
  policy: FlapPolicy;
  /** Timmar mellan två inlägg om samma butik+URL. Speglar RESTOCK_ALERT_COOLDOWN_HOURS. */
  cooldownHours: number;
  baseUrl: string;
}

export interface DeriveResult {
  posts: RestockPost[];
  nextState: DiscordRestockState;
  /** Diagnostik för körningsloggen — inte för användaren. */
  stats: {
    changes: number;
    seeded: boolean;
    /** Källor som seedades TYST denna körning (nya i state-filen). */
    seededSources: string[];
    skippedUnknownUrl: number;
    skippedFlap: number;
    skippedCooldown: number;
  };
}

const IN_STOCK = "IN_STOCK";

/**
 * ⛔ FÖRSTA KÖRNINGEN SEEDAR OCH POSTAR INGENTING. Utan `prev` ser varje vara i lager
 * ut som en nyhet — det hade blivit tusentals inlägg första gången, och igen varje gång
 * Actions-cachen faller ur (GitHub evictar efter 7 dygn utan träff, och LRU vid 10 GB).
 * Samma invariant som DB-vägens "ingen tidigare state → seeda".
 */
export function deriveRestockPosts(opts: DeriveOptions): DeriveResult {
  const { state, groups, rotating, routes, now, policy, cooldownHours, baseUrl } = opts;
  const prev = state ?? emptyState();
  const seeded = state == null || Object.keys(prev.stock).length === 0;

  const nextStock = mergeStateMap(prev.stock, groups);
  const stats: DeriveResult["stats"] = {
    changes: 0,
    seeded,
    seededSources: [],
    skippedUnknownUrl: 0,
    skippedFlap: 0,
    skippedCooldown: 0,
  };

  if (seeded) {
    return {
      posts: [],
      nextState: { stock: nextStock, history: prev.history, posted: prev.posted },
      stats,
    };
  }

  // ⛔ SEEDNINGEN GÄLLER PER KÄLLA, INTE BARA FÖR HELA FILEN (mätt 2026-08-12: när
  // MaxGaming lades till i butikslistan såg diffen alla dess ~41 lagerförda varor som
  // "ny-i-lager" och POSTADE 11 av dem som restocks — de var bara befintligt
  // sortiment). En källa utan en enda nyckel i förra lagerläget är NY: dess varor
  // seedas tyst genom att källan behandlas som roterande exakt den här körningen —
  // nästa körning har den nycklar i state och diffas som vanligt.
  const prevSources = new Set(
    Object.keys(prev.stock).map((k) => k.slice(0, k.indexOf("\t")))
  );
  const effectiveRotating = new Set(rotating);
  for (const g of groups) {
    if (g.items.length > 0 && !prevSources.has(g.sourceName) && !effectiveRotating.has(g.sourceName)) {
      effectiveRotating.add(g.sourceName);
      stats.seededSources.push(g.sourceName);
    }
  }

  const changes = actionableChanges(prev.stock, groups, effectiveRotating);
  stats.changes = changes.length;

  // Alla övergångar (även slutförsäljningar) in i historiken — flapp-fönstret räknar
  // ANTALET övergångar, precis som RestockEvent-tabellen det speglar.
  const history: Record<string, HistoryEntry[]> = {};
  const windowStart = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  for (const [key, entries] of Object.entries(prev.history)) {
    const kept = entries.filter((e) => e.t >= windowStart);
    if (kept.length) history[key] = kept;
  }
  for (const c of changes) {
    // "ABSENT" finns inte som StockStatus. En URL som dyker upp i lager motsvarar
    // DB-vägens nya offer, som skrivs med oldStatus OUT_OF_STOCK (runner.ts) — samma
    // skrivning här, annars dömer blink-regeln på ett tillstånd som inte finns.
    const oldStatus = c.from === "ABSENT" ? "OUT_OF_STOCK" : c.from;
    history[c.key] = [{ o: oldStatus, t: now.getTime() }, ...(history[c.key] ?? [])];
  }

  // Uppslag från nyckel → feed-annonsen, för titel/pris/bild.
  const itemByKey = new Map<string, { item: FeedItemFull; sourceName: string }>();
  for (const g of groups) {
    for (const it of g.items) itemByKey.set(`${g.sourceName}\t${it.url}`, { item: it, sourceName: g.sourceName });
  }

  // ⛔ LÄSES här, SKRIVS aldrig här. Cooldown-stämpeln sätts av `markPosted` EFTER att
  // Discord kvitterat — stämplar man vid beslutet tystas produkten i två timmar när
  // utskicket misslyckades, dvs precis när larmet inte kom fram.
  const posted = prev.posted;
  const posts: RestockPost[] = [];
  const cooldownMs = cooldownHours * 3600_000;

  for (const c of changes) {
    // Bara påfyllningar. En slutförsäljning är ingen nyhet för den som vill köpa.
    if (c.to !== IN_STOCK) continue;

    const found = itemByKey.get(c.key);
    if (!found) continue;
    const route = routes[found.item.url];
    if (!route) {
      stats.skippedUnknownUrl++;
      continue;
    }

    const flap = evaluateStockFlap(
      (history[c.key] ?? []).map((e) => ({ oldStatus: e.o as StockStatus, detectedAt: new Date(e.t) })),
      IN_STOCK as StockStatus,
      now,
      policy
    );
    if (flap.blip) {
      stats.skippedFlap++;
      continue;
    }

    const effectiveCooldownMs = Math.max(cooldownMs, flap.cooldownHours * 3600_000);
    const last = posted[c.key];
    if (last != null && now.getTime() - last < effectiveCooldownMs) {
      stats.skippedCooldown++;
      continue;
    }

    posts.push({
      key: c.key,
      // Katalogens titel framför butikens fras — butikstitlar bär "MAX 1 per kund",
      // "(kopia)" och liknande skräp som cleanListingTitle finns för att tvätta bort.
      title: route.title || found.item.title,
      storeName: found.sourceName,
      storeUrl: found.item.url,
      priceOre: found.item.price,
      imageUrl: found.item.imageUrl,
      setName: route.setName,
      series: route.series,
      productUrl: `${baseUrl.replace(/\/$/, "")}/produkter/${route.slug}`,
    });
  }

  return { posts, nextState: { stock: nextStock, history, posted: { ...posted } }, stats };
}

/**
 * Stämplar cooldown för de larm Discord FAKTISKT tog emot. Anropas med
 * `postRestocks().postedKeys`, aldrig med listan som skulle postas.
 *
 * Rensar samtidigt stämplar äldre än dygnsfönstret — utan det växer kartan i
 * cache-filen i evighet med URL:er butikerna slutat sälja.
 */
export function markPosted(
  state: DiscordRestockState,
  keys: string[],
  now: Date
): DiscordRestockState {
  const cutoff = now.getTime() - FLAP_WINDOW_HOURS * 3600_000;
  const posted: Record<string, number> = {};
  for (const [k, t] of Object.entries(state.posted)) if (t >= cutoff) posted[k] = t;
  for (const k of keys) posted[k] = now.getTime();
  return { ...state, posted };
}
