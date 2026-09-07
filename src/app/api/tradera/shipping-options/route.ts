/**
 * GET /api/tradera/shipping-options?single=1 — Traderas fraktalternativ per vikt.
 *
 * ⛔ RÖR ALDRIG DATABASEN. `requireUser()` läser JWT-sessionen, listan kommer ur
 * Traderas referensdata och cachas i minnet (lib/tradera-shipping.ts) — arket
 * kan alltså öppnas hur ofta som helst utan att väcka Neon.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { traderaCategoryId } from "@/lib/tradera-sell";
import { getShippingOptions } from "@/lib/tradera-shipping";

export const dynamic = "force-dynamic";

const schema = z.object({
  single: z.enum(["0", "1"]).default("1"),
  category: z.string().trim().max(40).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const params = schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const isSingle = params.single === "1";
    const spans = await getShippingOptions(traderaCategoryId(params.category ?? null, isSingle));
    return jsonOk({ spans });
  } catch (e) {
    return apiError(e);
  }
}
