import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { HEALTH_SECTIONS, healthAckKey } from "@/lib/store-health-findings";

export const dynamic = "force-dynamic";

const AckBody = z.object({
  /** Fyndraden som kvitteras — nyckeln räknas om på serversidan ur DEN, aldrig ur klientfält. */
  findingId: z.string().min(1),
});

/**
 * Admin: KVITTERA ett hälsokolls-fynd som KORREKT ("offern är rätt, rapporten har fel").
 * Kvitteringen överlever veckans omskrivning (stabil nyckel: sektion + offer-id/titel),
 * döljer fyndet i /admin/halsokoll och räknas bort ur den röda exit-koden i
 * audit-links/underpris-rapporten. Ångra = DELETE /api/admin/health-acks/[id].
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("ADMIN");
    const { findingId } = AckBody.parse(await req.json());

    const finding = await prisma.storeHealthFinding.findUnique({ where: { id: findingId } });
    if (!finding) throw new ServiceError(404, "Fyndet hittades inte (ny körning kan ha ersatt listan).");
    if (!(finding.section in HEALTH_SECTIONS))
      throw new ServiceError(400, "Okänd sektion kan inte kvitteras.");

    const key = healthAckKey(finding.section, finding);
    const ack = await prisma.storeHealthAck.upsert({
      where: { key },
      update: {},
      create: {
        key,
        section: finding.section,
        offerId: finding.offerId,
        title: finding.title,
        createdById: admin.id,
      },
    });

    await writeAuditLog({
      userId: admin.id,
      action: "healthFinding.ack",
      entityType: "StoreHealthFinding",
      entityId: finding.id,
      metadata: { key, section: finding.section, offerId: finding.offerId, title: finding.title },
    });

    return jsonOk({ ackId: ack.id, key });
  } catch (e) {
    return apiError(e);
  }
}
