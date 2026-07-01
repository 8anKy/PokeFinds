import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Kopplar från Tradera-kontot (raderar sparad token). */
export async function DELETE() {
  try {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { traderaUserId: null, traderaToken: null, traderaTokenExpiresAt: null },
    });
    return jsonOk({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
