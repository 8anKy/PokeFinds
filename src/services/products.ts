/**
 * Produkttjänster: sökning, detaljer, prishistorik och liknande produkter.
 * Rena funktioner utan framework-beroenden.
 */
import { prisma } from "@/lib/db";
import { cachedRead } from "@/lib/cache";
import { normalizeTitle } from "@/lib/utils";
import { ServiceError } from "@/lib/errors";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { getEngagementRanking } from "@/services/market";
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
  | "trending"
  | "deals";

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
  dealPercent?: number | null; // Fynd-feed: % under Cardmarket-referens (annars undefined)
  dealListingTitle?: string | null; // Fynd-feed: verifierad Tradera-annonstitel
}

/**
 * Ett "fynd" = en live Tradera-annons minst så här långt UNDER produktens
 * Cardmarket-referenspris. Global tröskel via env, default 30 %. Ren funktion → testbar.
 */
export const DEAL_MIN_DISCOUNT = Math.min(
  0.95,
  Math.max(0.05, (Number(process.env.DEAL_MIN_DISCOUNT_PCT) || 30) / 100)
);

/**
 * Övre tak: en rabatt STÖRRE än så här är nästan alltid skräp, inte ett fynd —
 * felmatchad Tradera-annons, auktions-startpris, eller en uppblåst CM-referens
 * (CM "From" är osmoothad → en enda feldyr/graderad annons drar upp riktmärket).
 * Läs-tids-filter (INGEN skrivvakt, historiken lämnas rå). Env-styrt, default 85 %.
 */
export const DEAL_MAX_DISCOUNT = Math.min(
  0.99,
  Math.max(DEAL_MIN_DISCOUNT, (Number(process.env.DEAL_MAX_DISCOUNT_PCT) || 85) / 100)
);

/** True om Tradera-priset (öre) ligger i fynd-bandet [min, max] under referenspriset. */
export function qualifiesAsDeal(
  traderaOre: number,
  referenceOre: number,
  minDiscount = DEAL_MIN_DISCOUNT,
  maxDiscount = DEAL_MAX_DISCOUNT
): boolean {
  if (referenceOre <= 0 || traderaOre <= 0) return false;
  const discount = 1 - traderaOre / referenceOre;
  return discount >= minDiscount && discount <= maxDiscount;
}

/** Max antal produkter som hämtas för beräknade sorteringar. */
const MAX_CANDIDATES = 500;

/**
 * SQL-villkor som speglar isDirectOfferUrl() (src/lib/marketplace-urls.ts):
 * sök-/bläddringslänkar + CM-redirecten exkluderas. Delas av pris-cachen och Fynd-feeden.
 */
const DIRECT_URL_SQL = `
  lower(url) NOT LIKE '%/search%'
  AND lower(url) NOT LIKE '%searchstring=%'
  AND lower(url) NOT LIKE '%sokstr=%'
  AND lower(url) NOT LIKE '%funk=sok%'
  AND lower(url) NOT LIKE '%?query=%' AND lower(url) NOT LIKE '%&query=%'
  AND lower(url) NOT LIKE '%?q=%' AND lower(url) NOT LIKE '%&q=%'
  AND lower(url) NOT LIKE '%prices.pokemontcg.io/cardmarket%'
`;

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
export function computePriceChange7d(
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

/** Språk katalogen visar. EN + JP är policyn; CN/KR/EU importeras inte och ska inte
 *  synas ens om något halkat in (isBlockedListingLanguage vaktar ingången). */
export const CATALOG_LANGUAGES: CardLanguage[] = ["EN", "JP"];

/**
 * Räknar om `Product.lowestPriceOre` = lägsta prissatta offer-pris (öre), null
 * om produkten saknar prissatt offer (→ gömd ur katalogen tills den får ett
 * pris igen). Körs efter scrape/refresh/import. Idempotent.
 */
export async function recomputeProductPriceCache(): Promise<void> {
  // En "räknbar" offer = prissatt (>0) OCH direkt produktlänk. URL-villkoret
  // speglar isDirectOfferUrl() så att cachen = produktsidans lägsta pris.
  // COALESCE(MIN i lager, MIN alla) = computeLowestPrice (IN_STOCK prioriteras).
  const DIRECT_PRICED = `price > 0 AND ${DIRECT_URL_SQL}`;
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
 * Skriver en daglig PriceSnapshot från det visade lägstapriset (`lowestPriceOre`)
 * för sealed-produkter som INTE redan fått en snapshot idag — dvs de som saknar
 * Cardmarket-trend (prissätts bara av svenska butiker, t.ex. league/GO-battle-decks).
 * Utan detta fryser deras historikgraf (cardmarket-refresh snapshottar bara CM-
 * mappade produkter). Priserna är ÄKTA observerade butikspriser → ingen fabrikation;
 * historiken byggs framåt. Kör SIST i den dagliga refreshen (efter CM-snapshots +
 * recompute) så CM-mappade produkter behåller sin trend och inget dubbelskrivs.
 * Returnerar antal skrivna snapshots.
 */
export async function snapshotStorePricedProducts(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const haveToday = new Set(
    (await prisma.priceSnapshot.findMany({ where: { date: today }, select: { productId: true } }))
      .map((s) => s.productId)
  );
  const products = await prisma.product.findMany({
    where: {
      lowestPriceOre: { not: null },
      category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] },
    },
    select: { id: true, lowestPriceOre: true },
  });
  const data = products
    .filter((p) => !haveToday.has(p.id))
    .map((p) => ({
      productId: p.id,
      date: today,
      minPrice: p.lowestPriceOre!,
      maxPrice: p.lowestPriceOre!,
      avgPrice: p.lowestPriceOre!,
      volume: 1,
    }));
  if (data.length === 0) return 0;
  await prisma.priceSnapshot.createMany({ data, skipDuplicates: true });
  return data.length;
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
  // Katalogen är EN + JP only. Utan detta var språk BARA ett användarfilter, så
  // default-vyn ("Alla språk") visade även OTHER-taggade produkter — de 6 spanska/
  // tyska Samlarhobby-boostrarna låg synliga i katalogen i fem dygn. Ett uttryckligt
  // filter respekteras, men "inget filter" betyder EN+JP, aldrig "allt".
  if (language) where.language = language;
  else where.language = { in: CATALOG_LANGUAGES };
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

/**
 * "Trendar" = engagemang (mest visade/klickade/sökta senaste 7 dagarna), INTE
 * prisrörelse. Sorterar en redan hämtad kandidatlista efter engagemangspoäng.
 * Produkter utan händelser får poäng 0 och behåller sin sekundära ordning (stabil
 * sort → recensrast/populärast först), så listan aldrig blir tom innan data hunnit
 * byggas upp. Poänglistan är 1h-cachad (getEngagementRanking) → billig.
 */
async function sortByEngagement(items: ProductListItem[]): Promise<void> {
  const ranking = await getEngagementRanking();
  const scoreBySlug = new Map(ranking.map((r) => [r.productSlug, r.score]));
  items.sort(
    (a, b) => (scoreBySlug.get(b.slug) ?? 0) - (scoreBySlug.get(a.slug) ?? 0)
  );
}

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
async function getExploreFeedRaw(
  params: SearchProductsParams,
  offset: number,
  limit: number
): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const { sort = "popular", minPrice, maxPrice } = params;
  if (sort === "deals") return getDealsRaw(offset, limit);
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
  else if (sort === "trending") await sortByEngagement(items);
  else if (sort === "recently_restocked") items.sort((a, b) => (b.lastRestockAt?.getTime() ?? 0) - (a.lastRestockAt?.getTime() ?? 0));
  const total = Math.min(items.length, MAX_CANDIDATES);
  return { items: items.slice(offset, offset + limit), total, hasMore: offset + limit < total };
}

// Gemensamt villkor: en Tradera-offer (alias o, produkt p, cm-CTE) i fynd-bandet mot
// Cardmarket, bara sealed, direkt annons-URL. Params: $1=cmId $2=traderaId $3=min $4=max.
const CM_MIN_CTE = `WITH cm AS (
  SELECT "productId", MIN(price) AS price FROM "Offer"
  WHERE "retailerId" = $1 AND price > 0 GROUP BY "productId"
)`;
const DEAL_OFFER_WHERE = `o."retailerId" = $2 AND o."stockStatus" = 'IN_STOCK' AND o.price > 0
  AND ${DIRECT_URL_SQL}
  AND p.category NOT IN ('SINGLE_CARD', 'GRADED_CARD', 'ACCESSORY', 'OTHER')
  AND o.price <= cm.price * (1 - $3)
  AND o.price >= cm.price * (1 - $4)`;

export interface DealCandidate {
  offerId: string;
  productId: string;
  traderaUrl: string;
  traderaPrice: number;
  cmPrice: number;
  title: string;
  category: string;
}

/**
 * Fynd-KANDIDATER (per Tradera-offer, ej verifierade) — indata till verify-deals-jobbet.
 * Referens = billigaste CM-offer (ALDRIG Product.lowestPriceOre — den inkluderar redan
 * Tradera-annonsen). Bara sealed (singlar har skick-brus). Liten mängd.
 */
export async function dealCandidateOffers(): Promise<DealCandidate[]> {
  const [cm, tr] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  if (!cm || !tr) return [];
  return prisma.$queryRawUnsafe<DealCandidate[]>(
    `${CM_MIN_CTE}
    SELECT o.id AS "offerId", o."productId" AS "productId", o.url AS "traderaUrl",
           o.price AS "traderaPrice", cm.price AS "cmPrice",
           p.title AS title, p.category::text AS category
    FROM "Offer" o
      JOIN cm ON cm."productId" = o."productId"
      JOIN "Product" p ON p.id = o."productId"
    WHERE ${DEAL_OFFER_WHERE}`,
    cm.id,
    tr.id,
    DEAL_MIN_DISCOUNT,
    DEAL_MAX_DISCOUNT
  );
}

/**
 * Fynd-feed (Pro): produkter med en LLM-VERIFIERAD Tradera-annons långt under sitt
 * Cardmarket-pris. Bara annonser vars DealCheck.ok=true, vars pris inte ändrats sedan
 * verifieringen, och som inte löpt ut. Väljer billigaste verifierade annons per produkt,
 * sorterat på störst rabatt.
 * ponytail: hämtar alla kvalade rader (3 fält) per sida — fynd är en liten mängd.
 */
async function getDealsRaw(
  offset: number,
  limit: number
): Promise<{ items: ProductListItem[]; total: number; hasMore: boolean }> {
  const [cm, tr] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.retailer.findFirst({ where: { name: "Tradera" }, select: { id: true } }),
  ]);
  if (!cm || !tr) return { items: [], total: 0, hasMore: false };

  const rows = await prisma.$queryRawUnsafe<
    { productId: string; discount: number; listingTitle: string | null }[]
  >(
    `${CM_MIN_CTE}
    SELECT d."productId", d.discount, d."listingTitle"
    FROM (
      SELECT DISTINCT ON (o."productId")
             o."productId" AS "productId",
             (cm.price - o.price)::float / cm.price AS discount,
             dc."listingTitle" AS "listingTitle"
      FROM "Offer" o
        JOIN cm ON cm."productId" = o."productId"
        JOIN "Product" p ON p.id = o."productId"
        JOIN "DealCheck" dc ON dc."offerId" = o.id
      WHERE ${DEAL_OFFER_WHERE}
        AND dc.ok = true
        AND dc."checkedPrice" = o.price
        AND (dc."endsAt" IS NULL OR dc."endsAt" > now())
      ORDER BY o."productId", o.price ASC
    ) d
    ORDER BY d.discount DESC`,
    cm.id,
    tr.id,
    DEAL_MIN_DISCOUNT,
    DEAL_MAX_DISCOUNT
  );

  const total = rows.length;
  const pageRows = rows.slice(offset, offset + limit);
  const products = await prisma.product.findMany({
    where: { id: { in: pageRows.map((r) => r.productId) } },
    include: FEED_INCLUDE,
  });
  const byId = new Map(products.map((p) => [p.id, toListItem(p)]));
  const items: ProductListItem[] = [];
  for (const r of pageRows) {
    const item = byId.get(r.productId);
    if (item)
      items.push({ ...item, dealPercent: Math.round(r.discount * 100), dealListingTitle: r.listingTitle });
  }
  return { items, total, hasMore: offset + pageRows.length < total };
}

async function searchProductsRaw(params: SearchProductsParams): Promise<{
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
      await sortByEngagement(items);
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

async function getProductBySlugRaw(slug: string) {
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
async function getPriceHistoryRaw(productId: string, days: number) {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { productId, date: { gte: daysAgo(days) } },
    orderBy: { date: "asc" },
    select: { date: true, minPrice: true, maxPrice: true, avgPrice: true, volume: true },
  });
  return snapshots;
}

/** Källor vars observationer utgör marknadspriset (Cardmarket-data). */
export const CARDMARKET_SOURCE_NAMES = ["Cardmarket", "Pokémon TCG API", "TCGdex API"];

/** Så många dagar får CM-trenden släpa efter butikernas färskaste punkt innan den
 *  räknas som död och grafen faller tillbaka på butikstrenden (CM-refresh kör dagligen
 *  → några dagars nåd tål ett hoppat jobb utan att friska produkter flippar källa). */
const TREND_STALE_DAYS = 3;

/** Marknadsplatser/priskällor — INTE butiker. Restock-larm ska aldrig avse dessa. */
export const NON_RETAIL_SOURCE_NAMES = [...CARDMARKET_SOURCE_NAMES, "Tradera"];

/**
 * "Återförsäljare" som egentligen är pris-DATAKÄLLOR (inte köpbara butiker) eller
 * mock — ska ALDRIG visas i butiksfiltret eller som köpbara offers. Cardmarket och
 * Tradera är riktiga marknadsplatser och behålls.
 */
export const NON_STORE_RETAILER_NAMES = [
  "Pokémon TCG API",
  "TCGdex API",
  "Mock-datakälla",
];

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
async function getPriceHistoryBySourceRaw(
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

/**
 * Hela produktsidans data i ETT serialiserbart paket — delas av SSR-sidan
 * (`/produkter/[slug]`) och produkt-overlayn (`/api/products/[slug]/detail`).
 * Datum är ISO-strängar (tål både Date och cache-serialiserad sträng).
 */
export interface ProductDetailData {
  id: string;
  slug: string;
  title: string;
  category: ProductCategory;
  language: CardLanguage;
  description: string | null;
  imageUrl: string | null;
  watchCount: number;
  updatedAt: string;
  set: { id: string; name: string } | null;
  restockEvents: {
    id: string;
    retailerName: string;
    newStatus: StockStatus;
    detectedAt: string;
  }[];
  /** Cardmarket-trendserie (hela perioden; klienten filtrerar). */
  chartData: SourceHistoryPoint[];
  /** Källa för historik-grafen → graf-rubrik (CM-trend vs butiks-snitt vs Tradera). */
  trendSource: "cardmarket" | "butiker" | "tradera";
  change7: number | null;
  change30: number | null;
  offerCount: number;
  stats: LiveOfferStats;
  serializedOffers: SerializedOffer[];
  affiliateRetailerIds: string[];
  similar: {
    slug: string;
    title: string;
    imageUrl: string | null;
    category: ProductCategory;
    lowestPrice: number | null;
    lowestPriceStockStatus: StockStatus | null;
  }[];
  /** Andra Cardmarket-versioner av samma kort (common ↔ special-variant). */
  variants: {
    slug: string;
    label: string;
    lowestPrice: number | null;
  }[];
}

interface LiveOfferStats {
  lowestPrice: number | null;
  lowestPriceStockStatus: StockStatus | null;
  highestPrice: number | null;
  avgPrice: number | null;
  offerCount: number;
}

interface SerializedOffer {
  id: string;
  price: number | null;
  shippingPrice: number | null;
  stockStatus: StockStatus;
  url: string;
  retailerId: string;
  retailer: {
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string;
    affiliateEnabled: boolean;
  };
}

const DETAIL_MAX_DAYS = 3650; // ~10 år = "hela serien" (klienten filtrerar period)

async function loadProductDetailRaw(slug: string): Promise<ProductDetailData | null> {
  const product = await getProductBySlug(slug).catch(() => null);
  if (!product) return null;

  const [historyBySource, similar, affiliateRetailers, variantSiblings] = await Promise.all([
    getPriceHistoryBySource(product.id, DETAIL_MAX_DAYS),
    getSimilarProducts(product.id, 4),
    prisma.retailer.findMany({
      where: {
        id: { in: product.offers.map((o) => o.retailerId) },
        affiliateEnabled: true,
      },
      select: { id: true },
    }),
    // Andra produkter för samma kort = Cardmarket-versioner (common ↔ variant).
    product.cardId
      ? prisma.product.findMany({
          where: { cardId: product.cardId, id: { not: product.id } },
          select: { slug: true, variantLabel: true, offers: { select: { price: true, stockStatus: true, url: true } } },
        })
      : Promise.resolve([]),
  ]);
  const variants = variantSiblings.map((v) => ({
    slug: v.slug,
    label: v.variantLabel ?? "Vanlig version",
    lowestPrice: computeLowestPrice(v.offers.filter((o) => isDirectOfferUrl(o.url))).price,
  }));
  const affiliateIds = new Set(affiliateRetailers.map((r) => r.id));

  // Endast direkta produktlänkar visas/räknas (samma regel som produktsidan).
  const directOffers = product.offers.filter((o) => isDirectOfferUrl(o.url));
  const prices = directOffers
    .map((o) => o.price)
    .filter((p): p is number => p !== null);
  const highestNow = prices.length > 0 ? Math.max(...prices) : null;
  const avgNow =
    prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;
  const directPriced = directOffers.filter(
    (o): o is (typeof directOffers)[number] & { price: number } => o.price !== null
  );
  const directInStock = directPriced.filter((o) => o.stockStatus === "IN_STOCK");
  const lowestPool = directInStock.length > 0 ? directInStock : directPriced;
  const directLowest =
    lowestPool.length > 0
      ? lowestPool.reduce((a, b) => (b.price < a.price ? b : a))
      : null;

  // Prishistorik: Cardmarket-trend i första hand — MEN bara så länge den fortfarande
  // uppdateras. En produkt som tappat sin CM-länk (t.ex. generisk butiks-stub utan
  // CM-motsvarighet) behåller sina gamla CM-punkter → utan recens-koll vann den frusna
  // CM-serien för alltid ("Cardmarket, senast 13 jul") medan butikerna postar färska
  // punkter dagligen. Välj därför CM bara om dess senaste punkt inte släpar mer än
  // TREND_STALE_DAYS efter butikernas färskaste; annars visa den levande butikstrenden.
  const latestDate = (s: SourceHistoryPoint[]): string | null =>
    s.length > 0 ? s[s.length - 1].date : null;
  const daysBetween = (a: string, b: string): number =>
    Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  const cmLatest = latestDate(historyBySource.cardmarket);
  const storeLatest = latestDate(historyBySource.butiker);
  const cmIsLive =
    cmLatest != null &&
    (storeLatest == null || daysBetween(cmLatest, storeLatest) <= TREND_STALE_DAYS);
  const trendSource: "cardmarket" | "butiker" | "tradera" = cmIsLive
    ? "cardmarket"
    : historyBySource.butiker.length > 0
      ? "butiker"
      : historyBySource.tradera.length > 0
        ? "tradera"
        : "cardmarket";
  const chartData = historyBySource[trendSource];
  const monthAgo = Date.now() - 30 * 86_400_000;
  const cm30 = chartData.filter((p) => new Date(p.date).getTime() >= monthAgo);
  const pctChange = (series: { price: number }[]): number | null =>
    series.length >= 2 && series[0].price > 0
      ? Math.round(
          ((series[series.length - 1].price - series[0].price) / series[0].price) * 10000
        ) / 100
      : null;
  const change30 = pctChange(cm30);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const change7 = pctChange(cm30.filter((p) => new Date(p.date).getTime() >= weekAgo));

  const serializedOffers: SerializedOffer[] = directOffers.map((o) => ({
    id: o.id,
    price: o.price,
    shippingPrice: o.shippingPrice,
    stockStatus: o.stockStatus,
    url: o.url,
    retailerId: o.retailerId,
    retailer: {
      id: o.retailer.id,
      name: o.retailer.name,
      logoUrl: o.retailer.logoUrl,
      websiteUrl: o.retailer.websiteUrl,
      affiliateEnabled: affiliateIds.has(o.retailerId),
    },
  }));

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    category: product.category,
    language: product.language,
    description: product.description,
    imageUrl: product.imageUrl,
    watchCount: product.watchCount,
    updatedAt: new Date(product.updatedAt).toISOString(),
    set: product.set ? { id: product.set.id, name: product.set.name } : null,
    restockEvents: product.restockEvents.map((e) => ({
      id: e.id,
      retailerName: e.retailer.name,
      newStatus: e.newStatus,
      detectedAt: new Date(e.detectedAt).toISOString(),
    })),
    chartData,
    trendSource,
    change7,
    change30,
    offerCount: directOffers.length,
    stats: {
      lowestPrice: directLowest?.price ?? null,
      lowestPriceStockStatus: directLowest?.stockStatus ?? null,
      highestPrice: highestNow,
      avgPrice: avgNow,
      offerCount: directOffers.length,
    },
    serializedOffers,
    affiliateRetailerIds: affiliateRetailers.map((r) => r.id),
    similar,
    variants,
  };
}

/** Liknande produkter: samma set i första hand, annars samma kategori. */
async function getSimilarProductsRaw(productId: string, limit = 8) {
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

// ponytail: publika läsfrågor cachas (datan uppdateras ~en gång/dygn av jobben).
// Sänker Neon network transfer — upprepade sidvisningar/crawls träffar cachen, inte DB:n.
export const getExploreFeed = cachedRead(getExploreFeedRaw, "getExploreFeed");
export const searchProducts = cachedRead(searchProductsRaw, "searchProducts");
export const getProductBySlug = cachedRead(getProductBySlugRaw, "getProductBySlug");
export const getPriceHistory = cachedRead(getPriceHistoryRaw, "getPriceHistory");
export const getPriceHistoryBySource = cachedRead(
  getPriceHistoryBySourceRaw,
  "getPriceHistoryBySource"
);
export const getSimilarProducts = cachedRead(getSimilarProductsRaw, "getSimilarProducts");
// Hela produktsidans data, cachad per slug → upprepade overlay-öppningar/sidvisningar
// träffar cachen (inte Neon). Datum serialiseras till strängar — ofarligt (se ProductDetailData).
export const loadProductDetail = cachedRead(loadProductDetailRaw, "loadProductDetail");
