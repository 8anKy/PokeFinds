import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["ACTIONED", "DISMISSED"]) });

/** Admin: stäng en "Något fel?"-anmälan (åtgärdad / avfärdad). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const { status } = schema.parse(await req.json());
    await prisma.productReport.update({ where: { id: params.id }, data: { status, resolvedAt: new Date() } });
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
