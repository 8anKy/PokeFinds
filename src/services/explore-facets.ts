import { Prisma, type ProductCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cachedRead } from "@/lib/cache";
import {
  buildProductWhere,
  CATALOG_LANGUAGES,
  HIDDEN_CATEGORIES,
} from "@/services/products";
import { PRINT_VARIANT_LABELS } from "@/lib/print-variant";

/**
 * Facetantal till desktop-katalogens filtersidofält (antal per kategori/set/butik,
 * prishistogram, "i lager"-antal). Antalen är GLOBALA — de smalnar inte av med
 * aktiva filter. Per-kombination-antal hade varit en ny Neon-fråga för varje
 * kryssruteklick; globala antal cachas EN gång i timmen och delas av alla besökare
 * (samma mönster och skäl som produkterFilterSets).
 */
export interface ExploreFacets {
  /** Antal synliga produkter totalt (samma villkor som katalogens grundvy). */
  total: number;
  /** Antal produkter med minst en offer i lager (= filtret "I lager"). */
  inStock: number;
  categories: { value: ProductCategory; count: number }[];
  sets: { id: string; count: number }[];
  retailers: { id: string; count: number }[];
  /** Produkter per prisintervall — kanterna i HISTOGRAM_EDGES_KR, sista = öppet uppåt. */
  priceBuckets: number[];
}

/**
 * Histogrammets/reglagets kanter i KRONOR. Reglagets lägen ÄR de här indexen
 * (sista läget = inget tak), så staplar och tumlägen kan aldrig glida isär.
 * Tätare steg i låga lägen där katalogen bor (median långt under 500 kr).
 */
export const HISTOGRAM_EDGES_KR = [
  0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
] as const;

/**
 * Synlighetsvillkoret som RÅ SQL — samma regel som buildProductWhere({}) (EN+JP,
 * inga gömda kategorier, prissatt ELLER tryckning). Behövs för frågorna Prisma
 * inte kan uttrycka (COALESCE över produktens/kortets set, width_bucket).
 * Refererar bara alias `p` så fragmentet kan delas av alla tre frågorna.
 */
const visibleSql = () => Prisma.sql`
  p."language"::text IN (${Prisma.join([...CATALOG_LANGUAGES])})
  AND p."category"::text NOT IN (${Prisma.join([...HIDDEN_CATEGORIES])})
  AND (p."lowestPriceOre" IS NOT NULL OR p."variantLabel" IN (${Prisma.join([...PRINT_VARIANT_LABELS])}))`;

async function getExploreFacetsRaw(): Promise<ExploreFacets> {
  const base = await buildProductWhere({});
  const thresholdsOre = HISTOGRAM_EDGES_KR.slice(1).map((kr) => kr * 100);

  const [total, inStock, categoryRows, setRows, retailerRows, bucketRows] = await Promise.all([
    prisma.product.count({ where: base }),
    prisma.product.count({
      where: { AND: [base, { offers: { some: { stockStatus: "IN_STOCK" } } }] },
    }),
    prisma.product.groupBy({ by: ["category"], where: base, _count: { _all: true } }),
    // Singelns set bor på KORTET (Product.setId är null där) — därav COALESCE,
    // exakt som setfiltret i buildProductWhere frågar på båda.
    prisma.$queryRaw<{ id: string; count: number }[]>`
      SELECT COALESCE(p."setId", c."setId") AS id, COUNT(*)::int AS count
      FROM "Product" p LEFT JOIN "Card" c ON c."id" = p."cardId"
      WHERE ${visibleSql()} AND COALESCE(p."setId", c."setId") IS NOT NULL
      GROUP BY 1`,
    // Samma offer-villkor som butiksfiltret i buildProductWhere (IN_STOCK +
    // prissatt + direkt länk) — annars lovar antalet fler träffar än klicket ger.
    prisma.$queryRaw<{ id: string; count: number }[]>`
      SELECT o."retailerId" AS id, COUNT(DISTINCT o."productId")::int AS count
      FROM "Offer" o JOIN "Product" p ON p."id" = o."productId"
      WHERE ${visibleSql()}
        AND o."stockStatus"::text = 'IN_STOCK'
        AND o."price" IS NOT NULL
        AND o."url" NOT ILIKE '%search%'
      GROUP BY 1`,
    // width_bucket(x, ARRAY[t1..tn]) = antal trösklar ≤ x → 0..n, dvs exakt ett
    // index per intervall i HISTOGRAM_EDGES_KR (sista = över högsta kanten).
    prisma.$queryRaw<{ bucket: number; count: number }[]>`
      SELECT width_bucket(p."lowestPriceOre", ARRAY[${Prisma.join(thresholdsOre)}]::int[]) AS bucket,
             COUNT(*)::int AS count
      FROM "Product" p
      WHERE ${visibleSql()} AND p."lowestPriceOre" IS NOT NULL
      GROUP BY 1`,
  ]);

  const priceBuckets = new Array<number>(HISTOGRAM_EDGES_KR.length).fill(0);
  for (const row of bucketRows) {
    if (row.bucket >= 0 && row.bucket < priceBuckets.length) priceBuckets[row.bucket] = row.count;
  }

  return {
    total,
    inStock,
    categories: categoryRows
      .map((r) => ({ value: r.category, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    sets: setRows,
    retailers: retailerRows,
    priceBuckets,
  };
}

export const getExploreFacets = cachedRead(getExploreFacetsRaw, "exploreFacets", 3600);

/**
 * Senaste gången någon feed faktiskt såg en butiksannons — driver "Uppdaterad …"-
 * raden i katalogens rubrik. ISO-sträng, inte Date: cachen serialiserar ändå till
 * JSON (Date→sträng-fällan), så typen säger sanningen direkt.
 */
export const getExploreLastSeen = cachedRead(
  async () => {
    const agg = await prisma.offer.aggregate({ _max: { lastSeenAt: true } });
    return agg._max.lastSeenAt?.toISOString() ?? null;
  },
  "exploreLastSeen",
  600
);
