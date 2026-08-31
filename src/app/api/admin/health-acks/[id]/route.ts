import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";

export const dynamic = "force-dynamic";

/** Admin: ÅNGRA en kvittering — fyndet syns igen och räknas som rött nästa körning. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireRole("ADMIN");

    const ack = await prisma.storeHealthAck.findUnique({ where: { id: params.id } });
    if (!ack) throw new ServiceError(404, "Kvitteringen hittades inte.");

    await prisma.storeHealthAck.delete({ where: { id: params.id } });
    await writeAuditLog({
      userId: admin.id,
      action: "healthFinding.unack",
      entityType: "StoreHealthAck",
      entityId: ack.id,
      metadata: { key: ack.key, section: ack.section, title: ack.title },
    });

    return jsonOk({ deleted: ack.id });
  } catch (e) {
    return apiError(e);
  }
}
