/**
 * GET /api/grading/jobs/[id]/photo?side=front|back — ett sparat graderingsfoto
 * (services/grading/photos.ts), bara för ägaren.
 *
 * Via vår egen rutt i stället för en signerad bucket-URL: bilden ritas på canvas
 * (slabbens "Mitt foto", utskärningen) och en annan origin utan CORS smutsar ned
 * canvasen — bucketen stöder ingen CORS-konfiguration (object-storage.ts).
 */
import { apiError } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { getObjectBytes, isGradingPhotoKey } from "@/lib/object-storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireEntitledUser();
    const side = new URL(req.url).searchParams.get("side");
    if (side !== "front" && side !== "back") throw new ServiceError(400, "Ogiltig sida.");
    const job = await prisma.gradingJob.findFirst({
      where: { id: params.id, userId: user.id },
      select: { result: true },
    });
    const keys = (job?.result as { photoKeys?: { front?: string | null; back?: string | null } | null } | null)
      ?.photoKeys;
    const key = keys?.[side];
    if (!key || !isGradingPhotoKey(key)) throw new ServiceError(404, "Bilden finns inte.");
    const bytes = await getObjectBytes(key).catch(() => null);
    if (!bytes) throw new ServiceError(404, "Bilden finns inte.");
    const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": type,
        // Privat: bara ägarens webbläsare får cacha. Fotot ändras aldrig för ett jobb.
        "Cache-Control": "private, max-age=604800, immutable",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
