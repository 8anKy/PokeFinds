/** POST /api/grading/grade — gradera ett kort utifrån fram- och baksidesbild. */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { effectivePlanTier } from "@/lib/plan";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { readJsonCapped } from "@/lib/body-limit";
import { getGradingQuota, runGradingJob } from "@/services/grading";

export const dynamic = "force-dynamic";

/** Maxstorlek per bild (~5 MB base64). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Hårt body-tak, verkställs INNAN kroppen buffras (två bilder ×1,4 + overhead). */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

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
  // Motiveringen skrivs AV MODELLEN och kan inte översättas i efterhand — därför
  // måste klientens språk följa med hit. Utan det svarade graderingen på svenska
  // för engelska användare (rapporterat 2026-08-05).
  locale: z.enum(["sv", "en"]).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireEntitledUser();

    const { ok } = await rateLimit(`grading:${user.id}`, 10, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har graderat för många kort på kort tid. Vänta några minuter och försök igen."
      );
    }

    const { front, back, cardName, locale } = gradeSchema.parse(
      await readJsonCapped(req, MAX_BODY_BYTES)
    );

    if (front.length > MAX_IMAGE_BYTES * 1.4 || back.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(
        413,
        "Bilden är för stor. Max 5 MB per bild. Prova att komprimera."
      );
    }

    const { job } = await runGradingJob(user.id, effectivePlanTier(user), front, back, {
      cardName,
      locale,
    });
    const quota = await getGradingQuota(user.id, effectivePlanTier(user));

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
