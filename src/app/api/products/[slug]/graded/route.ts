/**
 * GET /api/products/[slug]/graded — graderade priser (begärt + sålt + historik), PRO.
 *
 * Produktsidans payload är delad för alla (ISR) och bär därför inga graderade tal
 * (ägarbeslut 2026-09-17: graderade priser är Pro). Den här routen kontrollerar
 * planen ur sessionscookien (JWT — ingen DB) och svarar sedan ur SAMMA delade
 * cache som detaljen (`loadGradedForSlug`, produktens tagg). ⛔ `private, no-store`:
 * svaret är per person och får aldrig fastna i en mellanliggande cache.
 */
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { loadGradedForSlug } from "@/services/products";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const session = await auth();
    if (!session?.user) throw new ServiceError(401, "Logga in för att se graderade priser.");
    if (!session.user.isPro) throw new ServiceError(403, "Graderade priser ingår i Pro.");
    const data = await loadGradedForSlug(params.slug);
    if (!data) throw new ServiceError(404, "Produkten hittades inte.");
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
