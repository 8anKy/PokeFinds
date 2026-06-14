/** POST /api/grading/grade — gradera ett kort utifrån fram- och baksidesbild. */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getGradingQuota, runGradingJob } from "@/services/grading";

export const dynamic = "force-dynamic";

/** Maxstorlek per bild (~5 MB base64). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const imageData = z
  .string()
  .min(1, "Bild saknas.")
  .regex(
    /^data:image\/[a-z+.-]+;base64,/i,
    "Bilden måste vara en data-URL (image/*)."
  );

const gradeSchema = z.object({
  front: imageData,
  back: imageData,
  cardName: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const { ok } = await rateLimit(`grading:${user.id}`, 10, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har graderat för många kort på kort tid. Vänta några minuter och försök igen."
      );
    }

    const { front, back, cardName } = gradeSchema.parse(await req.json());

    if (front.length > MAX_IMAGE_BYTES * 1.4 || back.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(
        413,
        "Bilden är för stor. Max 5 MB per bild — prova att komprimera."
      );
    }

    const { job } = await runGradingJob(user.id, user.planTier, front, back, {
      cardName,
    });
    const quota = await getGradingQuota(user.id, user.planTier);

    return jsonOk(
      {
        jobId: job.id,
        status: job.status,
        overallGrade: job.overallGrade,
        confidence: job.confidence,
        modelUsed: job.modelUsed,
        result: job.result,
        quota,
      },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
