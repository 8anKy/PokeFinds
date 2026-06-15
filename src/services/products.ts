/**
 * Produkttjänster: sökning, detaljer, prishistorik och liknande produkter.
 * Rena funktioner utan framework-beroenden.
 */
import { prisma } from "@/lib/db";
import { normalizeTitle } from "@/lib/utils";
import { ServiceError } from "@/lib/errors";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import type {
  CardLanguage,
  Prisma,
  ProductCategory,
  StockStatus,
} from "@prisma/client";

export type ProductSort =
  | "price_asc"
  | "price_desc"
  | "biggest_drop"
  | "popular"
  | "recently_restocked"
  | "most_watched"
  | "trending";

export interface SearchProductsParams {
  query?: string;
  category?: ProductCategory;
  setId?: string;
  retailerId?: string;
  minPrice?: number; // öre
  maxPrice?: number; // öre
  stockStatus?: StockStatus;
  language?: CardLanguage;
  sort?: ProductSort;
  page: number;
  pageSize: number;
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  category: ProductCategory;
  imageUrl: string | null;
  language: CardLanguage;
  setId: string | null;
  setName: string | null;
  lowestPrice: number | null; // öre, IN_STOCK prioriteras
  lowestPriceStockStatus: StockStatus | null;
  offerCount: number;
  inStockCount: number;
  watchCount: number;
  viewCount: number;
  priceChange7d: number | null; // öre
  priceChange7dPercent: number | null;
  lastRestockAt: Date | null;
}

/** Max antal produkter som hämtas för beräknade sorteringar. */
const MAX_CANDIDATES = 500;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    set: { select: { id: true; name: true } };
    offers: { select: { price: true; stockStatus: true; url: true } };
    priceSnapshots: { select: { date: true; avgPrice: true } };
    restockEvents: { select: { detectedAt: true } };
    _count: { select: { watchlistItems: true } };
  };
}>;

export function computeLowestPrice(
  offers: { price: number | null; stockStatus: StockStatus }[]
): { price: number | null; stockStatus: StockStatus | null } {
  // Länk-offers utan pris (null) eller 0 öre (€0,00 = inget riktigt pris) räknas
  // inte in i lägsta pris.
  const priced = offers.filter(
    (o): o is { price: number; stockStatus: StockStatus } => o.price !== null && o.price > 0
  );
  if (priced.length === 0) return { price: null, stockStatus: null };
  const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : priced;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: best.price, stockStatus: best.stockStatus };
}

/** Prisförändring senaste 7 dagarna utifrån dagliga snapshots (öre + procent). */
function computePriceChange7d(
  snapshots: { date: Date; avgPrice: number }[]
): { change: number | null; percent: number | null } {
  if (snapshots.length < 2) return { change: null, percent: null };
  const sorted = [...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime());
  const oldest = sorted[0];
  const latest = sorted[sorted.length - 1];
  if (oldest.avgPrice <= 0) return { change: null, percent: null };
  const change = latest.avgPrice - oldest.avgPrice;
  const percent = Math.round((change / oldest.avgPrice) * 10000) / 100;
  return { change, percent };
}

function toListItem(p: ProductWithRelations): ProductListItem {
  // Endast offers med direkt produktlänk räknas — exakt som produktsidan.
  // Sök-/bläddringslänkar (Cardmarket-sök, CM-redirect, utgångna Tradera-annonser)
  // döljs och får INTE påverka lägsta pris eller butiksantal (annars visar katalogen
  // ett lägre "pris" än produktsidan, t.ex. 69 kr vs 251 kr).
  const visible = p.offers.filter((o) => isDirectOfferUrl(o.url));
  const lowest = computeLowestPrice(visible);
  const change = computePriceChange7d(p.priceSnapshots);
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    category: p.category,
    imageUrl: p.imageUrl,
    language: p.language,
    setId: p.setId,
    setName: p.set?.name ?? null,
    lowestPrice: lowest.price,
    lowestPriceStockStatus: lowest.stockStatus,
    offerCount: visible.length,
    inStockCount: visible.filter((o) => o.stockStatus === "IN_STOCK").length,
    watchCount: p._count.watchlistItems,
    viewCount: p.viewCount,
    priceChange7d: change.change,
    priceChange7dPercent: change.percent,
    lastRestockAt: p.restockEvents[0]?.detectedAt ?? null,
  };
}

/**
 * Kategorier som tills vidare är gömda ur katalogen (filter + listning).
 * Användaren bad 2026-06-14 att ta bort dem för nu (kan återinföras senare).
 */
export const HIDDEN_CATEGORIES: ProductCategory[] = ["ACCESSORY", "GRADED_CARD", "OTHER"];

/**
 * Räknar om `Product.lowestPriceOre` = lägsta prissatta offer-pris (öre), null
 * om produkten saknar prissatt offer (→ gömd ur katalogen tills den får ett
 * pris igen). Körs efter scrape/refresh/import. Idempotent.
 */
export async function recomputeProductPriceCache(): Promise<void> {
  // En "räknbar" offer = prissatt (>0) OCH direkt produktlänk. URL-villkoren
  // speglar isDirectOfferUrl() i src/lib/marketplace-urls.ts (sök-/bläddringslänkar
  // + CM-redirecten exkluderas) så att cachen = produktsidans lägsta pris.
  // COALESCE(MIN i lager, MIN alla) = computeLowestPrice (IN_STOCK prioriteras).
  const DIRECT_PRICED = `
    price > 0
    AND lower(url) NOT LIKE '%/search%'
    AND lower(url) NOT LIKE '%searchstring=%'
    AND lower(url) NOT LIKE '%sokstr=%'
    AND lower(url) NOT LIKE '%funk=sok%'
    AND lower(url) NOT LIKE '%?query=%' AND lower(url) NOT LIKE '%&query=%'
    AND lower(url) NOT LIKE '%?q=%' AND lower(url) NOT LIKE '%&q=%'
    AND lower(url) NOT LIKE '%prices.pokemontcg.io/cardmarket%'
  `;
  await prisma.$executeRawUnsafe(`
    UPDATE "Product" p SET "lowestPriceOre" = sub.lowest
    FROM (
      SELECT "productId",
        COALESCE(MIN(price) FILTER (WHERE "stockStatus" = 'IN_STOCK'), MIN(price)) AS lowest
      FROM "Offer" WHERE ${DIRECT_PRICED} GROUP BY "productId"
    ) sub
    WHERE p.id = sub."productId" AND p."lowestPriceOre" IS DISTINCT FROM sub.lowest
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "Product" SET "lowestPriceOre" = NULL
    WHERE "lowestPriceOre" IS NOT NULL
      AND id NOT IN (SELECT "productId" FROM "Offer" WHERE ${DIRECT_PRICED})
  `);
}

/**
 * Bygger Prisma-where ur sökparametrar (delas av katalog + utforska-feed).
 * Gömmer produkter UTAN prissatt offer (`lowestPriceOre = null`) — de dyker upp
 * automatiskt igen när de får ett pris (Cardmarket/Tradera).
 */
export async function buildProductWhere(
  params: Pick<SearchProductsParams, "query" | "category" | "setId" | "retailerId" | "stockStatus" | "language">
): Promise<Prisma.ProductWhereInput> {
  const { query, category, setId, retailerId, stockStatus, language } = params;
  const andClauses: Prisma.ProductWhereInput[] = [];

  if (query) {
    const words = normalizeTitle(query)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean);
    const hasCompoundWords = words.some((w) => w.length >= 6);
    let compactMatchIds: string[] | null = null;
    if (hasCompoundWords) {
      const conditions = words.map((_, i) => `REPLACE(LOWER("normalizedTitle"), ' ', '') LIKE $${i + 1}`);
      const values = words.map((w) => `%${w.toLowerCase()}%`);
      const sql = `SELECT "id" FROM "Product" WHERE ${conditions.join(" AND ")} LIMIT ${MAX_CANDIDATES}`;
      const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...values);
      compactMatchIds = rows.map((r) => r.id);
    }
    const wordClauses: Prisma.ProductWhereInput[] = words.map((w) => ({
      normalizedTitle: { contains: w, mode: "insensitive" as const },
    }));
    if (compactMatchIds && compactMatchIds.length > 0) {
      andClauses.push({ OR: [{ AND: wordClauses }, { id: { in: compactMatchIds } }] });
    } else {
      andClauses.push(...wordClauses);
    }
  }

  if (setId) {
    const setRecord = await prisma.cardSet.findUnique({ where: { id: setId }, select: { name: true } });
    const normalizedSetName = setRecord ? normalizeTitle(setRecord.name) : null;
    andClauses.push({
      OR: [
        { setId },
        { card: { setId } },
        ...(normalizedSetName
          ? [{ normalizedTitle: { contains: normalizedSetName, mode: "insensitive" as const } }]
          : []),
      ],
    });
  }

  const where: Prisma.ProductWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};
  if (category && !HIDDEN_CATEGORIES.includes(category)) where.category = category;
  else where.category = { notIn: HIDDEN_CATEGORIES };
  if (language) where.language = language;
  if (retailerId) {
    where.offers = {
      some: { retailerId, stockStatus: "IN_STOCK", price: { not: null }, NOT: { url: { contains: "search", mode: "insensitive" } } },
    };
  } else if (stockStatus) {
    where.offers = { some: { stockStatus } };
  }
  where.lowestPriceOre = { not: null }; // göm prislösa produkter
  return where;
}

/** Sorteringar som ordnas direkt i DB → infinite scroll över HELA katalogen. */
const DB_SORTABLE = new Set<ProductSort>(["popular", "price_asc", "price_desc", "most_watched"]);

function feedOrderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "price_asc": return { lowestPriceOre: "asc" };
    case "price_desc": return { lowestPriceOre: "desc" };
    case "most_watched": return { watchlistItems: { _count: "desc" } };
    default: return { viewCount: "desc" };
  }
}

const FEED_INCLUDE = {
  set: { select: { id: true, name: true } },
  offers: { select: { price: true, stockStatus: true, url: true } },
  priceSnapshots: { where: { date: { gte: daysAgo(7) } }, select: { date: true, avgPrice: true } },
  restockEvents: { orderBy: { detectedAt: "desc" }, take: 1, select: { detectedAt: true } },
  _count: { select: { watchlistItems: true } },
} as const;

/**
 * Utforska-feed med offset-paginering (infinite scroll). DB-sorterbara
 * sorteringar paginerar över HELA katalogen; beräknade sorteringar (prisfall/
 * trend/restock) körs över topp-MAX_CANDIDATES (scrollen stannar där).
 */
export async function getExploreFeed(
  params: SearchProductsParams,
  offset: number,
  limit: number
): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const { sort = "popular", minPrice, maxPrice } = params;
  const where = await buildProductWhere(params);
  if (minPrice !== undefined || maxPrice !== undefined) {
    where.lowestPriceOre = {
      not: null,
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    };
  }

  if (DB_SORTABLE.has(sort)) {
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: FEED_INCLUDE,
        orderBy: [feedOrderBy(sort), { id: "asc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    const items = products.map(toListItem);
    return { items, total, hasMore: offset + items.length < total };
  }

  // Beräknade sorteringar: topp-N-kandidater, sortera i minnet, skiva.
  const products = await prisma.product.findMany({
    where,
    include: FEED_INCLUDE,
    take: MAX_CANDIDATES,
    orderBy: { updatedAt: "desc" },
  });
  const items = products.map(toListItem);
  if (sort === "biggest_drop") items.sort((a, b) => (a.priceChange7dPercent ?? 0) - (b.priceChange7dPercent ?? 0));
  else if (sort === "trending") items.sort((a, b) => (b.priceChange7dPercent ?? 0) - (a.priceChange7dPercent ?? 0));
  else if (sort === "recently_restocked") items.sort((a, b) => (b.lastRestockAt?.getTime() ?? 0) - (a.lastRestockAt?.getTime() ?? 0));
  const total = Math.min(items.length, MAX_CANDIDATES);
  return { items: items.slice(offset, offset + limit), total, hasMore: offset + limit < total };
}

export async function searchProducts(params: SearchProductsParams): Promise<{
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const { minPrice, maxPrice, sort = "popular", page, pageSize } = params;

  // Filter (inkl. gömning av prislösa produkter) byggs av den delade
  // buildProductWhere — samma logik som utforska-feeden.
  const where = await buildProductWhere(params);

  const products = await prisma.product.findMany({
    where,
    include: {
      set: { select: { id: true, name: true } },
      offers: { select: { price: true, stockStatus: true, url: true } },
      priceSnapshots: {
        where: { date: { gte: daysAgo(7) } },
        select: { date: true, avgPrice: true },
      },
      restockEvents: {
        orderBy: { detectedAt: "desc" },
        take: 1,
        select: { detectedAt: true },
      },
      _count: { select: { watchlistItems: true } },
    },
    take: MAX_CANDIDATES,
    orderBy: { updatedAt: "desc" },
  });

  let items = products.map(toListItem);

  // Prisfilter appliceras på lägsta pris
  if (minPrice !== undefined) {
    items = items.filter((i) => i.lowestPrice !== null && i.lowestPrice >= minPrice);
  }
  if (maxPrice !== undefined) {
    items = items.filter((i) => i.lowestPrice !== null && i.lowestPrice <= maxPrice);
  }

  const byPrice = (a: ProductListItem, b: ProductListItem, dir: 1 | -1) => {
    if (a.lowestPrice === null && b.lowestPrice === null) return 0;
    if (a.lowestPrice === null) return 1;
    if (b.lowestPrice === null) return -1;
    return (a.lowestPrice - b.lowestPrice) * dir;
  };

  switch (sort) {
    case "price_asc":
      items.sort((a, b) => byPrice(a, b, 1));
      break;
    case "price_desc":
      items.sort((a, b) => byPrice(a, b, -1));
      break;
    case "biggest_drop":
      items.sort(
        (a, b) => (a.priceChange7dPercent ?? 0) - (b.priceChange7dPercent ?? 0)
      );
      break;
    case "trending":
      items.sort(
        (a, b) => (b.priceChange7dPercent ?? 0) - (a.priceChange7dPercent ?? 0)
      );
      break;
    case "most_watched":
      items.sort((a, b) => b.watchCount - a.watchCount);
      break;
    case "recently_restocked":
      items.sort(
        (a, b) =>
          (b.lastRestockAt?.getTime() ?? 0) - (a.lastRestockAt?.getTime() ?? 0)
      );
      break;
    case "popular":
    default:
      items.sort((a, b) => b.viewCount - a.viewCount);
      break;
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function getProductBySlug(slug: string) {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      set: true,
      card: true,
      offers: {
        include: { retailer: { select: { id: true, name: true, logoUrl: true, websiteUrl: true } } },
        orderBy: { price: { sort: "asc", nulls: "last" } },
      },
      restockEvents: {
        orderBy: { detectedAt: "desc" },
        take: 20,
        include: { retailer: { select: { id: true, name: true } } },
      },
      priceSnapshots: {
        where: { date: { gte: daysAgo(7) } },
        select: { date: true, avgPrice: true },
      },
      _count: { select: { watchlistItems: true } },
    },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const lowest = computeLowestPrice(
    product.offers
      .filter((o) => isDirectOfferUrl(o.url))
      .map((o) => ({ price: o.price, stockStatus: o.stockStatus }))
  );
  const change = computePriceChange7d(product.priceSnapshots);

  const { priceSnapshots: _snapshots, _count, ...rest } = product;
  return {
    ...rest,
    watchCount: _count.watchlistItems,
    lowestPrice: lowest.price,
    lowestPriceStockStatus: lowest.stockStatus,
    priceChange7d: change.change,
    priceChange7dPercent: change.percent,
  };
}

/** Prishistorik (dagliga snapshots) för grafer. */
export async function getPriceHistory(productId: string, days: number) {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { productId, date: { gte: daysAgo(days) } },
    orderBy: { date: "asc" },
    select: { date: true, minPrice: true, maxPrice: true, avgPrice: true, volume: true },
  });
  return snapshots;
}

/** Källor vars observationer utgör marknadspriset (Cardmarket-data). */
export const CARDMARKET_SOURCE_NAMES = ["Cardmarket", "Pokémon TCG API", "TCGdex API"];

export interface SourceHistoryPoint {
  date: string; // YYYY-MM-DD
  price: number; // öre, dagligt snitt
}

export interface PriceHistoryBySource {
  cardmarket: SourceHistoryPoint[];
  tradera: SourceHistoryPoint[];
  butiker: SourceHistoryPoint[];
}

/**
 * Prishistorik per källa (dagliga snitt av riktiga prisobservationer):
 * - cardmarket: Cardmarket-priser (prisguide + pokemontcg.io/TCGdex trend/avg-aggregat)
 * - tradera: skrapade Tradera-listningar
 * - butiker: svenska butiksskrapare (Spelexperten, Webhallen m.fl.)
 */
export async function getPriceHistoryBySource(
  productId: string,
  days: number
): Promise<PriceHistoryBySource> {
  const observations = await prisma.priceObservation.findMany({
    where: { productId, observedAt: { gte: daysAgo(days) } },
    orderBy: { observedAt: "asc" },
    select: { price: true, observedAt: true, source: { select: { name: true } } },
  });

  const buckets = {
    cardmarket: new Map<string, { sum: number; n: number }>(),
    tradera: new Map<string, { sum: number; n: number }>(),
    butiker: new Map<string, { sum: number; n: number }>(),
  };

  for (const o of observations) {
    const name = o.source?.name ?? null;
    const group =
      name === "Tradera"
        ? "tradera"
        : name && CARDMARKET_SOURCE_NAMES.includes(name)
          ? "cardmarket"
          : "butiker";
    const day = o.observedAt.toISOString().slice(0, 10);
    const b = buckets[group].get(day) ?? { sum: 0, n: 0 };
    b.sum += o.price;
    b.n += 1;
    buckets[group].set(day, b);
  }

  const toSeries = (m: Map<string, { sum: number; n: number }>): SourceHistoryPoint[] =>
    [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, { sum, n }]) => ({ date, price: Math.round(sum / n) }));

  return {
    cardmarket: toSeries(buckets.cardmarket),
    tradera: toSeries(buckets.tradera),
    butiker: toSeries(buckets.butiker),
  };
}

/** Liknande produkter: samma set i första hand, annars samma kategori. */
export async function getSimilarProducts(productId: string, limit = 8) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, setId: true, category: true },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const include = {
    set: { select: { id: true, name: true } },
    offers: { select: { price: true, stockStatus: true, url: true } },
  } as const;

  const sameSet = product.setId
    ? await prisma.product.findMany({
        where: { setId: product.setId, id: { not: product.id } },
        include,
        take: limit,
        orderBy: { viewCount: "desc" },
      })
    : [];

  let results = sameSet;
  if (results.length < limit) {
    const sameCategory = await prisma.product.findMany({
      where: {
        category: product.category,
        id: { notIn: [product.id, ...results.map((r) => r.id)] },
      },
      include,
      take: limit - results.length,
      orderBy: { viewCount: "desc" },
    });
    results = [...results, ...sameCategory];
  }

  return results.map((p) => {
    const lowest = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      category: p.category,
      imageUrl: p.imageUrl,
      language: p.language,
      setName: p.set?.name ?? null,
      lowestPrice: lowest.price,
      lowestPriceStockStatus: lowest.stockStatus,
    };
  });
}

/**
 * Aktuellt marknadsvärde (öre) per produkt-id = produktens lägsta pris
 * (singel = Cardmarket-trend, sealed = lägsta butikspris). Samma mått som
 * produktsidans rubrik. Produkter utan prissatt offer utelämnas.
 */
export async function getProductValues(
  productIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, offers: { select: { price: true, stockStatus: true, url: true } } },
  });
  for (const p of products) {
    const { price } = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    if (price != null) map.set(p.id, price);
  }
  return map;
}

/**
 * Aktuellt marknadsvärde (öre) per kort-id via kortets produkt(er). Om flera
 * produkter pekar på samma kort väljs det lägsta priset. Kort utan prissatt
 * produkt utelämnas.
 */
export async function getCardValues(
  cardIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (cardIds.length === 0) return map;
  const products = await prisma.product.findMany({
    where: { cardId: { in: cardIds } },
    select: { cardId: true, offers: { select: { price: true, stockStatus: true, url: true } } },
  });
  for (const p of products) {
    if (!p.cardId) continue;
    const { price } = computeLowestPrice(p.offers.filter((o) => isDirectOfferUrl(o.url)));
    if (price == null) continue;
    const prev = map.get(p.cardId);
    if (prev == null || price < prev) map.set(p.cardId, price);
  }
  return map;
}
