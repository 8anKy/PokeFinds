/**
 * POST /api/admin/scrape-jobs/run — startar ett insamlingsjobb manuellt.
 * Kräver ADMIN. Rate limit: 10 per minut.
 * MVP: jobbet körs synkront (await) och sammanfattningen returneras.
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { apiError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { runScrapeJob } from "@/scrapers/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  sourceId: z.string().min(1, "sourceId krävs."),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole("ADMIN");

    const { ok } = await rateLimit(`scrape-run:${user.id}`, 10, 60_000);
    if (!ok) {
      return NextResponse.json(
        { error: "För många förfrågningar. Försök igen om en minut." },
        { status: 429 }
      );
    }

    const { sourceId } = bodySchema.parse(await req.json());
    const summary = await runScrapeJob(sourceId);
    return jsonOk(summary);
  } catch (error) {
    return apiError(error);
  }
}
