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
  categories: { value: ProductCategory; count: number }[];
  sets: { id: string; count: number }[];
  retailers: { id: string; count: number }[];
}

/**
 * Synlighetsvillkoret som RÅ SQL — samma regel som buildProductWhere({}) (EN+JP,
 * inga gömda kategorier, prissatt ELLER tryckning). Behövs för frågorna Prisma
 * inte kan uttrycka (COALESCE över produktens/kortets set, width_bucket).
 * Refererar bara alias `p` så fragmentet kan delas av alla tre frågorna.
 */
const visibleSql = () => Prisma.sql`
  p."hiddenAt" IS NULL
  AND p."language"::text IN (${Prisma.join([...CATALOG_LANGUAGES])})
  AND p."category"::text NOT IN (${Prisma.join([...HIDDEN_CATEGORIES])})
  AND (p."lowestPriceOre" IS NOT NULL OR p."variantLabel" IN (${Prisma.join([...PRINT_VARIANT_LABELS])}))`;

async function getExploreFacetsRaw(): Promise<ExploreFacets> {
  const base = await buildProductWhere({});

  const [categoryRows, setRows, retailerRows] = await Promise.all([
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
  ]);

  return {
    categories: categoryRows
      .map((r) => ({ value: r.category, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    sets: setRows,
    retailers: retailerRows,
  };
}

export const getExploreFacets = cachedRead(getExploreFacetsRaw, "exploreFacets", 3600);
