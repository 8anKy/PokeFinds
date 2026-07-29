import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonCached } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getExploreFeed } from "@/services/products";
import { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";

/**
 * Kommaseparerad lista → array. "Fler filter" är flerval, så kategori/butik/språk
 * kan komma som `category=ETB,BOOSTER_BOX`. Okända värden KASTAS (inte fel): en
 * gammal bokmärkt URL med en borttagen butik ska ge en katalog utan det filtret,
 * inte ett 400.
 */
function csvEnum<T extends Record<string, string>>(e: T) {
  const valid = new Set(Object.values(e));
  return z
    .string()
    .optional()
    .transform((s) =>
      s
        ? (s.split(",").map((v) => v.trim()).filter((v) => valid.has(v)) as T[keyof T][])
        : undefined
    )
    .transform((list) => (list && list.length > 0 ? list : undefined));
}

const csvString = z
  .string()
  .optional()
  .transform((s) => {
    const list = s ? s.split(",").map((v) => v.trim()).filter(Boolean) : [];
    return list.length > 0 ? list : undefined;
  });

/** Utforska-feed: offset-paginerad (infinite scroll). */
const feedSchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: csvEnum(ProductCategory),
  setId: z.string().optional(),
  retailerId: csvString,
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  stockStatus: z.nativeEnum(StockStatus).optional(),
  language: csvEnum(CardLanguage),
  sort: z
    .enum(["price_asc", "price_desc", "biggest_drop", "popular", "recently_restocked", "most_watched", "trending", "deals", "card_number_asc", "card_number_desc"])
    .optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export async function GET(req: NextRequest) {
  try {
    const { offset, limit, ...params } = feedSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    // Fynd-feeden är Pro-only — gratis/utloggade får tom lista (infinite scroll stannar).
    if (params.sort === "deals") {
      const session = await auth();
      if (!session?.user?.isPro) {
        return Response.json({ items: [], total: 0, hasMore: false });
      }
    }
    const result = await getExploreFeed({ ...params, page: 1, pageSize: limit }, offset, limit);
    return jsonCached(result, 120);
  } catch (e) {
    return apiError(e);
  }
}
