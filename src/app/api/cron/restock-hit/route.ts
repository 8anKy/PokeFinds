/**
 * POST /api/cron/restock-hit — Discord-lanens larm-hits (se src/lib/restock-hits.ts).
 *
 * Skyddas av x-cron-secret = CRON_SECRET, som de andra cron-rutterna. Anroparen är
 * GitHub-jobbet discord-restock.yml, som kör med en avsiktligt död DATABASE_URL —
 * det här är dess ENDA väg till databasen, och den går via oss.
 *
 * ⛔ PAUSAT LÄGE RÖR INTE DATABASEN. `restockAlertsPaused()` läser bara env, så ett
 *    "paused"-svar kostar noll vaken tid. Det är också hela på/av-spaken: sätt
 *    RESTOCK_ALERTS_PAUSED=0 i Railway (ny deploy — copyn bakas in vid bygget) och
 *    larmen går; ingen workflow behöver slås på, ingen pinger höjas.
 * ⛔ `ensureDbAwake()` FÖRE arbetet: Neon sover troligen (det är poängen), och den
 *    första riktiga frågan ska inte bära kallstarten (P1017-racet 2026-07-12).
 * ⛔ dispatchPendingAlerts körs ALLTID när databasen ändå är vaken — även äldre
 *    PENDING-rader från andra vägar ska ut i samma fönster i stället för att vänta.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { ensureDbAwake } from "@/lib/db";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { restockHitBatchSchema } from "@/lib/restock-hits";
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

    if (restockAlertsPaused()) {
      return jsonOk({ ok: true, paused: true, received: hits.length });
    }

    await ensureDbAwake();
    const applied = await applyRestockHits(hits);
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
