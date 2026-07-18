/** Marknadstjänster: trender, prisras, mest bevakade, restocks, set-index, statistik. */
import { prisma } from "@/lib/db";
import { cachedRead } from "@/lib/cache";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface ProductChange {
  productId: string;
  firstPrice: number;
  lastPrice: number;
  change: number; // öre
  changePercent: number;
}

/**
 * Golv för trendlistor: 10 kr. Endagssnitt (avg1) för billiga bulk-kort är
 * extremt volatila på Cardmarket (en enda försäljning à €0,02 ger ±6000 %) —
 * riktiga priser, men meningslösa som "marknadsrörelser".
 */
const MOVER_MIN_PRICE_ORE = 1000;

/** Beräknar prisförändring per produkt utifrån snapshots de senaste `days` dagarna.
 *  Aggregeras i SQL (första/sista avgPrice per produkt) — att hämta ALLA snapshot-
 *  rader (~150k) hit och vika dem i JS var Neons enskilt största egress-post
 *  (~15 MB/anrop). Nu returneras ≤1 liten rad per produkt. */
async function computeChangesRaw(days = 7): Promise<ProductChange[]> {
  // Explicit datumsträng + ::date-cast: en rå timestamp-parameter jämförs mot
  // DATE-kolumnen med andra tidszons-/cast-regler än Prismas query engine och
  // förskjuter fönstret en dag.
  const since = daysAgo(days);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
  const rows = await prisma.$queryRaw<
    { productId: string; first: number; last: number }[]
  >`
    SELECT "productId",
           (array_agg("avgPrice" ORDER BY date ASC))[1]  AS first,
           (array_agg("avgPrice" ORDER BY date DESC))[1] AS last
    FROM "PriceSnapshot"
    WHERE date >= ${sinceStr}::date
    GROUP BY "productId"
    HAVING count(*) >= 2`;

  const changes: ProductChange[] = [];
  for (const { productId, first, last } of rows) {
    if (first < MOVER_MIN_PRICE_ORE || last < MOVER_MIN_PRICE_ORE) continue;
    const change = last - first;
    changes.push({
      productId,
      firstPrice: first,
      lastPrice: last,
      change,
      changePercent: Math.round((change / first) * 10000) / 100,
    });
  }
  return changes;
}

// Delas av trending/ras/set-index (tidigare körde var och en sin egen fullskanning).
// Snapshots skrivs ~en gång/dygn → 1h cache är osynlig.
const computeChanges = cachedRead(computeChangesRaw, "computeChanges", 3600);

async function attachProducts(changes: ProductChange[]) {
  const products = await prisma.product.findMany({
    where: { id: { in: changes.map((c) => c.productId) } },
    select: {
      id: true,
      title: true,
      slug: true,
      imageUrl: true,
      category: true,
      set: { select: { id: true, name: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return changes
    .filter((c) => byId.has(c.productId))
    .map((c) => ({ ...c, product: byId.get(c.productId)! }));
}

/** Produkter med störst prisökning senaste 7 dagarna. */
async function getTrendingRaw(limit = 10) {
  const changes = (await computeChanges(7))
    .filter((c) => c.change > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, limit);
  return attachProducts(changes);
}

/** Produkter med störst prisfall senaste 7 dagarna. */
async function getTopDropsRaw(limit = 10) {
  const changes = (await computeChanges(7))
    .filter((c) => c.change < 0)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, limit);
  return attachProducts(changes);
}

/** Mest bevakade produkter. */
async function getMostWatchedRaw(limit = 10) {
  const grouped = await prisma.watchlistItem.groupBy({
    by: ["productId"],
    _count: { productId: true },
    orderBy: { _count: { productId: "desc" } },
    take: limit,
  });
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: {
      id: true,
      title: true,
      slug: true,
      imageUrl: true,
      category: true,
      offers: { select: { price: true, stockStatus: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return grouped
    .filter((g) => byId.has(g.productId))
    .map((g) => {
      const p = byId.get(g.productId)!;
      const priced = p.offers.filter((o) => o.price !== null) as {
        price: number;
        stockStatus: string;
      }[];
      const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
      const pool = inStock.length > 0 ? inStock : priced;
      const { offers: _offers, ...rest } = p;
      return {
        ...rest,
        watchCount: g._count.productId,
        lowestPrice: pool.length > 0 ? Math.min(...pool.map((o) => o.price)) : null,
      };
    });
}

/**
 * ENGAGEMANG ("Trendar") — vad folk faktiskt tittar på, klickar på och söker sig
 * fram till just nu. Definitionen av "trending" i appen: INTE prisrörelse (det är
 * "Störst uppgång/prisfall"), utan uppmätt intresse de senaste 7 dagarna.
 *
 * Läses ur den befintliga, ANONYMA `AnalyticsEvent`-loggen (ingen userId/IP/e-post
 * lagras — GDPR-grön aggregatstatistik). Tre händelsetyper, viktade efter avsikt:
 * en sökning som leder till en produkt väger tyngst, en ren vy lättast.
 */
const ENGAGEMENT_WEIGHTS = {
  product_view: 1,
  list_click: 2,
  search_click: 3,
} as const;
const ENGAGEMENT_EVENT_TYPES = Object.keys(ENGAGEMENT_WEIGHTS);

export interface EngagementCount {
  /** Produktens slug — engagemangshändelserna nycklas på slug (det länkarna,
   *  produktvyn och sökförslagen alla bär), inte på produkt-id. */
  productSlug: string;
  views: number;
  clicks: number;
  searches: number;
  score: number;
}

/** En grupperad (slug, typ)-rad från AnalyticsEvent-aggregeringen. */
export interface EngagementGroupRow {
  entityId: string | null;
  eventType: string;
  count: number;
}

/**
 * REN funktion: viktar och summerar grupperade händelser till en sorterad
 * topplista (högst poäng först). Utbruten för att kunna enhetstestas utan DB.
 */
export function foldEngagement(
  rows: EngagementGroupRow[],
  limit?: number
): EngagementCount[] {
  const byProduct = new Map<string, EngagementCount>();
  for (const row of rows) {
    if (!row.entityId) continue;
    const slug = row.entityId;
    const entry =
      byProduct.get(slug) ??
      { productSlug: slug, views: 0, clicks: 0, searches: 0, score: 0 };
    const n = row.count;
    if (row.eventType === "product_view") entry.views += n;
    else if (row.eventType === "list_click") entry.clicks += n;
    else if (row.eventType === "search_click") entry.searches += n;
    entry.score +=
      n * (ENGAGEMENT_WEIGHTS[row.eventType as keyof typeof ENGAGEMENT_WEIGHTS] ?? 0);
    byProduct.set(slug, entry);
  }
  const sorted = Array.from(byProduct.values()).sort((a, b) => b.score - a.score);
  return limit ? sorted.slice(0, limit) : sorted;
}

/** Summerar engagemangshändelser per produkt de senaste `days` dagarna (viktad poäng).
 *  En liten groupBy per (slug, typ) — inga per-rad-hämtningar (Neon-billigt). */
async function aggregateEngagementRaw(
  days: number,
  limit?: number
): Promise<EngagementCount[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["entityId", "eventType"],
    where: {
      eventType: { in: ENGAGEMENT_EVENT_TYPES },
      entityId: { not: null },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  return foldEngagement(
    grouped.map((g) => ({
      entityId: g.entityId,
      eventType: g.eventType,
      count: g._count._all,
    })),
    limit
  );
}

/** Hydrerar engagemangsräkningar med produktinfo (samma två-stegs-mönster som
 *  getMostWatched: groupBy → findMany), matchat på slug. */
async function hydrateEngagement(counts: EngagementCount[]) {
  if (counts.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { slug: { in: counts.map((c) => c.productSlug) } },
    select: {
      id: true,
      title: true,
      slug: true,
      imageUrl: true,
      category: true,
      lowestPriceOre: true,
      set: { select: { id: true, name: true } },
    },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  return counts
    .filter((c) => bySlug.has(c.productSlug))
    .map((c) => ({ ...c, product: bySlug.get(c.productSlug)! }));
}

/** Mest engagerade produkter senaste 7 dagarna (hydrerad, för publik "Trendar"). */
async function getEngagementTrendingRaw(limit = 10) {
  return hydrateEngagement(await aggregateEngagementRaw(7, limit));
}

/**
 * Senaste påfyllningar — bara de som FORTFARANDE är i lager. En restock-händelse
 * är historik; allokerings-droppar (t.ex. Webhallen "Tillfälligt fullbokad") kan
 * vara slutsålda igen inom minuter. Vi visar därför bara events vars offer just nu
 * är IN_STOCK (samma offer-status som produktsidans pristabell läser), så listan
 * aldrig säger "I lager" på något som klick-länken visar som slut.
 */
async function getRecentRestocksRaw(limit = 20) {
  const events = await prisma.restockEvent.findMany({
    where: { newStatus: "IN_STOCK" },
    include: {
      product: { select: { id: true, title: true, slug: true, imageUrl: true } },
      retailer: { select: { id: true, name: true, logoUrl: true } },
    },
    orderBy: { detectedAt: "desc" },
    take: limit * 4, // över-hämta: vissa filtreras bort som slutsålda
  });

  // Aktuell lagerstatus per (produkt, butik) — finns någon IN_STOCK-offer kvar?
  const inStock = await prisma.offer.findMany({
    where: {
      stockStatus: "IN_STOCK",
      productId: { in: events.map((e) => e.productId) },
      retailerId: { in: events.map((e) => e.retailerId) },
    },
    select: { productId: true, retailerId: true },
  });
  const live = new Set(inStock.map((o) => `${o.productId}:${o.retailerId}`));

  return events
    .filter((e) => live.has(`${e.productId}:${e.retailerId}`))
    .slice(0, limit);
}

/** Genomsnittlig prisförändring per set (7 dagar). */
async function getSetIndexRaw() {
  const changes = await computeChanges(7);
  if (changes.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: changes.map((c) => c.productId) }, setId: { not: null } },
    select: { id: true, setId: true },
  });
  const setByProduct = new Map(products.map((p) => [p.id, p.setId!]));

  const perSet = new Map<string, { sum: number; count: number }>();
  for (const c of changes) {
    const setId = setByProduct.get(c.productId);
    if (!setId) continue;
    const entry = perSet.get(setId) ?? { sum: 0, count: 0 };
    entry.sum += c.changePercent;
    entry.count += 1;
    perSet.set(setId, entry);
  }

  const sets = await prisma.cardSet.findMany({
    where: { id: { in: Array.from(perSet.keys()) } },
    select: { id: true, name: true, series: true, logoUrl: true },
  });

  return sets
    .map((s) => {
      const entry = perSet.get(s.id)!;
      return {
        ...s,
        productCount: entry.count,
        avgChangePercent: Math.round((entry.sum / entry.count) * 100) / 100,
      };
    })
    .sort((a, b) => b.avgChangePercent - a.avgChangePercent);
}

/** Övergripande marknadsstatistik. */
async function getMarketStatsRaw() {
  const [
    productCount,
    offerCount,
    inStockOffers,
    retailerCount,
    restocks24h,
    observations24h,
    watchlistCount,
  ] = await prisma.$transaction([
    prisma.product.count(),
    prisma.offer.count(),
    prisma.offer.count({ where: { stockStatus: "IN_STOCK" } }),
    prisma.retailer.count({ where: { isActive: true } }),
    prisma.restockEvent.count({
      where: { detectedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
    prisma.priceObservation.count({
      where: { observedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
    prisma.watchlistItem.count(),
  ]);

  return {
    productCount,
    offerCount,
    inStockOffers,
    retailerCount,
    restocks24h,
    observations24h,
    watchlistCount,
  };
}

// ponytail: marknadssidan + landningen cachas (datan uppdateras ~en gång/dygn av jobben).
export const getTrending = cachedRead(getTrendingRaw, "getTrending");
export const getTopDrops = cachedRead(getTopDropsRaw, "getTopDrops");

// Engagemang ("Trendar"): 1h-cache räcker — händelser strömmar in men listan
// behöver inte vara sekundfärsk, och 1h håller Neon-läsningarna nere (som computeChanges).
export const getEngagementTrending = cachedRead(
  getEngagementTrendingRaw,
  "getEngagementTrending",
  3600
);
/** Rå poänglista (alla engagerade produkter, 7 dgr) för katalogens "Trendar"-sortering. */
export const getEngagementRanking = cachedRead(
  () => aggregateEngagementRaw(7),
  "getEngagementRanking",
  3600
);
/** Admin-topplista med valbart fönster (ocachad — admin-sidan är force-dynamic). */
export async function getEngagementLeaderboard(days: number, limit: number) {
  return hydrateEngagement(await aggregateEngagementRaw(days, limit));
}
export const getMostWatched = cachedRead(getMostWatchedRaw, "getMostWatched");
export const getRecentRestocks = cachedRead(getRecentRestocksRaw, "getRecentRestocks");
export const getSetIndex = cachedRead(getSetIndexRaw, "getSetIndex");
export const getMarketStats = cachedRead(getMarketStatsRaw, "getMarketStats");
