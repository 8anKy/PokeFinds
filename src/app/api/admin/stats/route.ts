import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getAdminStats } from "@/services/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("ADMIN");
    const stats = await getAdminStats();
    return jsonOk(stats);
  } catch (e) {
    return apiError(e);
  }
}
