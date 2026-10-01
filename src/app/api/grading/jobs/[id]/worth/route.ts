/**
 * GET /api/grading/jobs/[id]/worth — "Lönar det sig att gradera?" för en TIDIGARE
 * gradering (2026-10-01). Räknas vid behov, aldrig sparat: marknadsvärdet och de
 * sålda graderade priserna rör sig, så ett lagrat svar hade blivit gammalt.
 * Bara när användaren själv öppnar en gradering ur historiken — en läsning per tryck.
 */
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { effectivePlanTier } from "@/lib/plan";
import { gradingWorth } from "@/services/grading/extras";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireEntitledUser();
    const job = await prisma.gradingJob.findFirst({
      where: { id: params.id, userId: user.id, status: "COMPLETED" },
      select: { overallGrade: true, result: true },
    });
    if (!job) throw new ServiceError(404, "Graderingen hittades inte.");
    const r = (job.result ?? {}) as { cardId?: string | null; cardSlug?: string | null };
    const worth =
      job.overallGrade != null
        ? await gradingWorth(r.cardId, r.cardSlug, job.overallGrade, effectivePlanTier(user) === "PREMIUM")
        : null;
    return jsonOk({ worth });
  } catch (e) {
    return apiError(e);
  }
}
