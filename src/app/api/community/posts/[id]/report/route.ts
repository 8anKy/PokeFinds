import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { reportPost } from "@/services/community";

export const dynamic = "force-dynamic";

const reportSchema = z.object({
  reason: z.string().trim().min(3, "Ange en anledning.").max(1000),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);

    const { ok } = await rateLimit(`community-report:${user.id}`, 10, 60 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har rapporterat för många gånger på kort tid. Försök igen senare."
      );
    }

    const { reason } = reportSchema.parse(await req.json());
    const report = await reportPost(params.id, user.id, reason);
    return jsonOk({ id: report.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
