/**
 * POST /api/cron/scrape — körs av extern cron (t.ex. Vercel Cron eller crontab).
 * Skyddas av headern x-cron-secret som måste matcha env CRON_SECRET.
 * OBS: CRON_SECRET MÅSTE vara satt i miljön — annars nekas alla anrop.
 *
 * Kör alla aktiva källor + skickar väntande alerts.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { runScheduledScrapesOnce } from "@/jobs/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("[cron] CRON_SECRET saknas i miljön — cron-routen är avstängd.");
      return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }

    const result = await runScheduledScrapesOnce();
    return jsonOk({
      sources: result.scrapes.length,
      scrapes: result.scrapes,
      alerts: result.alerts,
    });
  } catch (error) {
    return apiError(error);
  }
}
