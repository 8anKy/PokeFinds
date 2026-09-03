import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { hasRole, requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { setChatReportStatus } from "@/services/chat";
import { writeAuditLog } from "@/services/analytics";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["OPEN", "REVIEWED", "ACTIONED"]) });

/** Moderator+: sätt status på en chatt-anmälan. Bokförs i audit-loggen som postrapporterna. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    if (!hasRole(user.role, "MODERATOR")) throw new ServiceError(403, "Åtkomst nekad.");
    const input = schema.parse(await req.json());
    const report = await setChatReportStatus(params.id, input.status);
    await writeAuditLog({
      userId: user.id,
      action: "chatReport.resolve",
      entityType: "ChatReport",
      entityId: params.id,
      metadata: { status: input.status },
    });
    return jsonOk(report);
  } catch (e) {
    return apiError(e);
  }
}
