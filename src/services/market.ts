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

/** Beräknar prisförändring per produkt utifrån snapshots de senaste `days` dagarna. */
async function computeChanges(days = 7): Promise<ProductChange[]> {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { date: { gte: daysAgo(days) } },
    orderBy: [{ productId: "asc" }, { date: "asc" }],
    select: { productId: true, date: true, avgPrice: true },
  });

  const byProduct = new Map<string, { first: number; last: number; days: number }>();
  for (const s of snapshots) {
    const entry = byProduct.get(s.productId);
    if (!entry) {
      byProduct.set(s.productId, { first: s.avgPrice, last: s.avgPrice, days: 1 });
    } else {
      entry.last = s.avgPrice;
      entry.days += 1;
    }
  }

  const changes: ProductChange[] = [];
  for (const [productId, { first, last, days: dayCount }] of byProduct) {
    if (dayCount < 2) continue;
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
export const getMostWatched = cachedRead(getMostWatchedRaw, "getMostWatched");
export const getRecentRestocks = cachedRead(getRecentRestocksRaw, "getRecentRestocks");
export const getSetIndex = cachedRead(getSetIndexRaw, "getSetIndex");
export const getMarketStats = cachedRead(getMarketStatsRaw, "getMarketStats");
