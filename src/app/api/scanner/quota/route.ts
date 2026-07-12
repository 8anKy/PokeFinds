/** GET /api/scanner/quota — månadens skanningskvot för inloggad användare (badge). */
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { effectivePlanTier, isPro } from "@/lib/plan";
import { getScannerQuota } from "@/services/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const { remaining, limit } = await getScannerQuota(user.id, effectivePlanTier(user));
    return jsonOk({ remaining, limit, isPremium: isPro(user) });
  } catch (e) {
    return apiError(e);
  }
}
