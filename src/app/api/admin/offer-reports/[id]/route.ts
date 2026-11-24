import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["ACTIONED", "DISMISSED"]) });

/**
 * Admin: stäng en anmäld butikslänk UTAN att röra länken (åtgärdad / avfärdad).
 *
 * Förut gick en länkanmälan bara att bli av med genom "Ta bort länken" — en felaktig anmälan
 * (Rogerz "fel pris": anmälaren läste danska kronor) eller en som redan lösts (halvboxen flyttad
 * till rätt produkt, varan redan slut) tvingade admin att antingen radera en RIKTIG länk eller
 * låta anmälan ligga kvar för alltid. Statusen är bara bokföring — ingenting annat ändras.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const { status } = schema.parse(await req.json());
    await prisma.offerReport.update({ where: { id: params.id }, data: { status, resolvedAt: new Date() } });
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
