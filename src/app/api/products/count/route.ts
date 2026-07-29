import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonCached } from "@/lib/api";
import { countProducts } from "@/services/products";
import { csvEnum, csvString } from "@/lib/query-params";
import { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";

/**
 * Hur många produkter ETT filterurval ger — utan att applicera det.
 *
 * Mobilens filter-sheets visar antalet på knappen medan man bockar i, så man ser vad
 * valet leder till innan man trycker. Samma frågesträng och samma tolkning som
 * /api/products/feed (delade csv-hjälparna) → knappen och feeden kan inte säga emot
 * varandra.
 *
 * Svaret beror INTE på vem som frågar (personaliseringen ändrar ordning, inte antal)
 * → cachas publikt i 5 min, och tjänsten har dessutom sin egen cache på urvalet.
 */
const countSchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: csvEnum(ProductCategory),
  setId: z.string().optional(),
  retailerId: csvString,
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  stockStatus: z.nativeEnum(StockStatus).optional(),
  language: csvEnum(CardLanguage),
});

export async function GET(req: NextRequest) {
  try {
    const params = countSchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const count = await countProducts({ ...params, page: 1, pageSize: 1 });
    return jsonCached({ count }, 300);
  } catch (e) {
    return apiError(e);
  }
}
