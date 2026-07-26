import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getProductRestocks, getRecentRestocks } from "@/services/market";

/**
 * Restock-huvudboken är ADMIN-ONLY (2026-07-26). Den är en driftlogg, inte en
 * produktfunktion: en butik som pytsar ut en het vara skriver dussintals
 * "i lager/slut" per dygn (Dragon's Lair: 45 övergångar på tre dygn för EN box),
 * och den listan säger en vanlig besökare ingenting sant om vad som går att köpa.
 * Bevakarna får sina restock-larm som vanligt.
 *
 * force-dynamic + jsonOk: svaret beror på inloggningen och får ALDRIG cachas
 * publikt (jsonCached sätter `public` i Cache-Control).
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Utelämnad = senaste påfyllningarna över hela katalogen (marknadsvyn).
  productId: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN");
    const { limit, productId } = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    const items = productId
      ? await getProductRestocks(productId, limit)
      : await getRecentRestocks(limit);
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}
