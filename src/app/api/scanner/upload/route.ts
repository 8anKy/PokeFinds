/** POST /api/scanner/upload — ladda upp kortbild och starta skanning. */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { runScannerJob } from "@/services/scanner";

export const dynamic = "force-dynamic";

/** Maxstorlek för bilddata (~4 MB base64). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const uploadSchema = z.object({
  image: z
    .string()
    .min(1, "Bild saknas.")
    .regex(/^data:image\/[a-z+.-]+;base64,/i, "Bilden måste vara en data-URL (image/*)."),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const { ok } = await rateLimit(`scanner-upload:${user.id}`, 10, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har skannat för många kort på kort tid. Vänta några minuter och försök igen."
      );
    }

    const { image } = uploadSchema.parse(await req.json());

    if (image.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ServiceError(
        413,
        "Bilden är för stor. Max 4 MB — prova att förminska eller komprimera bilden."
      );
    }

    const { job, candidates } = await runScannerJob(user.id, user.planTier, image);

    return jsonOk(
      {
        jobId: job.id,
        status: job.status,
        confidence: job.confidence,
        candidates,
      },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
