import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonCached } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getExploreFeed } from "@/services/products";
import { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";

/** Utforska-feed: offset-paginerad (infinite scroll). */
const feedSchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: z.nativeEnum(ProductCategory).optional(),
  setId: z.string().optional(),
  retailerId: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  stockStatus: z.nativeEnum(StockStatus).optional(),
  language: z.nativeEnum(CardLanguage).optional(),
  sort: z
    .enum(["price_asc", "price_desc", "biggest_drop", "popular", "recently_restocked", "most_watched", "trending", "deals"])
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
      if (session?.user?.planTier !== "PREMIUM") {
        return Response.json({ items: [], total: 0, hasMore: false });
      }
    }
    const result = await getExploreFeed({ ...params, page: 1, pageSize: limit }, offset, limit);
    return jsonCached(result, 120);
  } catch (e) {
    return apiError(e);
  }
}
