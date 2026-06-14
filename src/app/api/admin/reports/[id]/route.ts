import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { resolveReport } from "@/services/community";
import { writeAuditLog } from "@/services/analytics";
import { ReportStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  status: z.nativeEnum(ReportStatus),
  hidePost: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const moderator = await requireRole("MODERATOR");
    const input = updateSchema.parse(await req.json());

    const report = await resolveReport(params.id, input.status, {
      hidePost: input.hidePost,
    });

    await writeAuditLog({
      userId: moderator.id,
      action: "report.resolve",
      entityType: "Report",
      entityId: params.id,
      metadata: { status: input.status, hidePost: input.hidePost ?? false },
    });

    return jsonOk(report);
  } catch (e) {
    return apiError(e);
  }
}
