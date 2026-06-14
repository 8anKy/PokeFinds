/**
 * POST /api/admin/scrape — admin-only endpoint to trigger a scrape run.
 * Accepts optional { sourceId } to scrape a single source, or runs all active.
 * No CRON_SECRET needed — uses session auth with ADMIN role check.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { auth, hasRole } from "@/lib/auth";
import { apiError, jsonOk } from "@/lib/api";
import { runAllActiveSources, runScrapeJob } from "@/scrapers/runner";
import { dispatchPendingAlerts } from "@/services/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    sourceId: z.string().optional(),
  })
  .optional();

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
      return NextResponse.json({ error: "Åtkomst nekad." }, { status: 403 });
    }

    const body = bodySchema.parse(await req.json().catch(() => undefined));
    const sourceId = body?.sourceId;

    if (sourceId) {
      const summary = await runScrapeJob(sourceId);
      const alerts = await dispatchPendingAlerts();
      return jsonOk({ scrapes: [summary], alerts });
    }

    const scrapes = await runAllActiveSources();
    const alerts = await dispatchPendingAlerts();
    return jsonOk({
      sources: scrapes.length,
      scrapes,
      alerts,
    });
  } catch (error) {
    return apiError(error);
  }
}
