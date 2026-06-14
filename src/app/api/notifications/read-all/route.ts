import { apiError, jsonOk } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireUser();
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return jsonOk({ updated: result.count });
  } catch (e) {
    return apiError(e);
  }
}
