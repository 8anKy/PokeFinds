/**
 * POST /api/cron/alerts-due — MORGONRUNDAN för nattens prislarm (2026-09-28).
 *
 * Prislarm som skapas under tysta timmar (22–07 svensk tid, `lib/quiet-hours.ts`) bär
 * `Alert.notBefore` = 07:00. Den här rutten skickar allt som hunnit förfalla. Startas en
 * gång per morgon av väckarklockan i discord-restock.yml (via morning-alerts.yml) —
 * EN Neon-väckning per dygn, ≈ 5 min debiterad tid. Varje annat utskick (larm-hits,
 * nattkedjan) tar också med sig förfallna rader, så rundan är en golvgaranti, inte
 * enda vägen.
 *
 * Sedan 2026-10-19 skickar rundan även provperiodens meddelanden (services/trial-messages.ts).
 *
 * Skyddas av x-cron-secret = CRON_SECRET, som de andra cron-rutterna.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { ensureDbAwake } from "@/lib/db";
import { dispatchPendingAlerts } from "@/services/notifications";
import { runTrialMessages } from "@/services/trial-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error("[alerts-due] CRON_SECRET saknas i miljön — rutten är avstängd.");
      return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    }
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }
    await ensureDbAwake();
    const dispatched = await dispatchPendingAlerts();
    console.log(`[alerts-due] Morgonrundan: skickade ${dispatched.sent}, misslyckade ${dispatched.failed}.`);
    // Provperiodens värdebesked (dag 7) och påminnelse (dag 12) — samma väckning.
    const trial = await runTrialMessages();
    console.log(
      `[alerts-due] Provperioder: ${trial.candidates} pågående, ${trial.reminders} påminnelser, ` +
        `${trial.reminderFailures} misslyckade, ${trial.values} värdebesked (${trial.valuesSkipped} utan underlag).`
    );
    // ⛔ En påminnelse som inte gick iväg ska synas som en RÖD körning (workflowen kräver 200).
    if (trial.reminderFailures > 0) {
      return NextResponse.json({ ok: false, dispatched, trial }, { status: 502 });
    }
    return jsonOk({ ok: true, dispatched, trial });
  } catch (error) {
    return apiError(error);
  }
}
