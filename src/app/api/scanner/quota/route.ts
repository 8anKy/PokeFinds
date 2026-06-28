/** GET /api/scanner/quota — månadens skanningskvot för inloggad användare (badge). */
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getScannerQuota } from "@/services/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const { remaining, limit } = await getScannerQuota(user.id, user.planTier);
    return jsonOk({ remaining, limit, isPremium: user.planTier === "PREMIUM" });
  } catch (e) {
    return apiError(e);
  }
}
