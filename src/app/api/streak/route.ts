import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { effectivePlanTier } from "@/lib/plan";
import { getStreakState } from "@/services/streak";

export const dynamic = "force-dynamic";

/** Veckoseriens tillstånd för kortet på Utforska. 60 s minnescache i tjänsten. */
export async function GET() {
  try {
    const user = await requireEntitledUser();
    const state = await getStreakState(user.id, effectivePlanTier(user));
    return jsonOk({ ...state, isPro: effectivePlanTier(user) === "PREMIUM" });
  } catch (e) {
    return apiError(e);
  }
}
