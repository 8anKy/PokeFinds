/**
 * GET /api/scanner/search?q= — manuell kortsökning INUTI skannern.
 *
 * "Sök manuellt" navigerade förut till katalogen, och skannerns skanningar (som
 * bara finns i minnet) försvann. Svaret har SAMMA form som skanningens
 * kandidater, så ett valt kort blir träffen precis som ett val ur listan.
 * Gäster (appens enhets-id) får söka — de får skanna. Kostar ingen kvot: det är
 * ingen identifiering, bara en katalogfråga.
 */
import type { NextRequest } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { actorKey, resolveScanActor } from "@/lib/scan-actor";
import { searchScannerCards } from "@/services/scanner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveScanActor(req);
    const { ok } = await rateLimit(`scanner-search:${actorKey(actor)}`, 60, 60 * 1000);
    // Samma (översatta) text som skanningens tak — se api-error-i18n.ts.
    if (!ok) throw new ServiceError(429, "För många skanningar på kort tid. Vänta en stund.");
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
    const candidates = await searchScannerCards(q);
    return jsonOk({ candidates });
  } catch (e) {
    return apiError(e);
  }
}
