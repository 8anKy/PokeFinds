/**
 * POST /api/cron/restock-hit — Discord-lanens larm-hits (se src/lib/restock-hits.ts).
 *
 * Skyddas av x-cron-secret = CRON_SECRET, som de andra cron-rutterna. Anroparen är
 * GitHub-jobbet discord-restock.yml, som kör med en avsiktligt död DATABASE_URL —
 * det här är dess ENDA väg till databasen, och den går via oss.
 *
 * ⛔ PAUSAT LÄGE RÖR INTE DATABASEN. Två grindar, en per hit-sort: `restockAlertsPaused()`
 *    för påfyllningar och `priceAlertsPaused()` för prissänkningar — de pausas av OLIKA
 *    skäl (CLAUDE.md) och slås på var för sig. Båda läser bara env, så ett "paused"-svar
 *    kostar noll vaken tid. Är HELA batchen pausad svarar vi `paused: true` utan DB;
 *    annars appliceras det som är påslaget och resten räknas som hoppade.
 *    PÅ/AV = RESTOCK_ALERTS_PAUSED / PRICE_ALERTS_PAUSED i Railway (ny deploy — copyn
 *    bakas in vid bygget); ingen workflow behöver slås på, ingen pinger höjas.
 * ⛔ `ensureDbAwake()` FÖRE arbetet: Neon sover troligen (det är poängen), och den
 *    första riktiga frågan ska inte bära kallstarten (P1017-racet 2026-07-12).
 * ⛔ dispatchPendingAlerts körs ALLTID när databasen ändå är vaken — även äldre
 *    PENDING-rader från andra vägar ska ut i samma fönster i stället för att vänta.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { ensureDbAwake } from "@/lib/db";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { hitKind, restockHitBatchSchema } from "@/lib/restock-hits";
import { applyRestockHits } from "@/services/restock-hits";
import { dispatchPendingAlerts } from "@/services/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("[restock-hit] CRON_SECRET saknas i miljön — rutten är avstängd.");
      return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }
    const { hits } = restockHitBatchSchema.parse(await req.json());

    const restockPaused = restockAlertsPaused();
    const pricePaused = priceAlertsPaused();
    const live = hits.filter((h) => (hitKind(h) === "PRICE_DROP" ? !pricePaused : !restockPaused));
    const pausedRestock = hits.filter((h) => hitKind(h) === "RESTOCK").length - live.filter((h) => hitKind(h) === "RESTOCK").length;
    const pausedPrice = hits.length - live.length - pausedRestock;
    if (live.length === 0) {
      return jsonOk({ ok: true, paused: true, received: hits.length });
    }

    await ensureDbAwake();
    const applied = await applyRestockHits(live);
    if (pausedRestock > 0) applied.skipped["restock-pausat"] = pausedRestock;
    if (pausedPrice > 0) applied.skipped["prislarm-pausat"] = pausedPrice;
    applied.received = hits.length;
    const dispatched = await dispatchPendingAlerts();
    const skipped = Object.entries(applied.skipped)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    console.log(
      `[restock-hit] ${applied.received} hits → ${applied.matched} matchade, ${applied.events} händelser, ` +
        `${applied.alerts} larm; skickade ${dispatched.sent}, misslyckade ${dispatched.failed}` +
        `${skipped ? ` (hoppade: ${skipped})` : ""}.`
    );
    return jsonOk({ ok: true, paused: false, ...applied, dispatched });
  } catch (error) {
    return apiError(error);
  }
}
