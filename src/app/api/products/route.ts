import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { searchProducts } from "@/services/products";
import { trackEvent } from "@/services/analytics";
import { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: z.nativeEnum(ProductCategory).optional(),
  setId: z.string().optional(),
  minPrice: z.coerce.number().int().min(0).optional(), // öre
  maxPrice: z.coerce.number().int().min(0).optional(), // öre
  stockStatus: z.nativeEnum(StockStatus).optional(),
  language: z.nativeEnum(CardLanguage).optional(),
  sort: z
    .enum([
      "price_asc",
      "price_desc",
      "biggest_drop",
      "popular",
      "recently_restocked",
      "most_watched",
      "trending",
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export async function GET(req: NextRequest) {
  try {
    const params = searchSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const result = await searchProducts(params);
    if (params.query) {
      await trackEvent("search", undefined, {
        query: params.query,
        results: result.total,
      });
    }
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
