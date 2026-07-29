import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonCached } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getExploreFeed } from "@/services/products";
import { csvEnum, csvString } from "@/lib/query-params";
import { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";

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
  // "popular" finns kvar som giltigt värde (gamla länkar/bokmärken) men mappas till
  // best_match av normalizeSort i services/products.
  sort: z
    .enum(["best_match", "price_asc", "price_desc", "biggest_drop", "popular", "recently_restocked", "most_watched", "trending", "deals", "card_number_asc", "card_number_desc", "title_asc", "title_desc"])
    .optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export async function GET(req: NextRequest) {
  try {
    const { offset, limit, ...params } = feedSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    // "Bäst matchning" lyfter dina egna bevakningar/samling → sessionen behövs, och
    // svaret får då INTE ligga i en delad cache. Övriga sorteringar är identiska för
    // alla och cachas som förut.
    const personalizable = !params.sort || params.sort === "best_match" || params.sort === "popular";
    const session = params.sort === "deals" || personalizable ? await auth() : null;

    // Fynd-feeden är Pro-only — gratis/utloggade får tom lista (infinite scroll stannar).
    if (params.sort === "deals" && !session?.user?.isPro) {
      return Response.json({ items: [], total: 0, hasMore: false });
    }

    const userId = personalizable ? session?.user?.id : undefined;
    const result = await getExploreFeed(
      { ...params, userId, page: 1, pageSize: limit },
      offset,
      limit
    );
    return userId ? Response.json(result) : jsonCached(result, 120);
  } catch (e) {
    return apiError(e);
  }
}
