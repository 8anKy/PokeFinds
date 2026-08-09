/** GET /api/grading/jobs — användarens senaste graderingar + dagens kvot. */
import { apiError, jsonOk } from "@/lib/api";
import { requireEntitledUser } from "@/lib/auth";
import { effectivePlanTier } from "@/lib/plan";
import { getGradingQuota, listGradingJobs } from "@/services/grading";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireEntitledUser();
    const [jobs, quota] = await Promise.all([
      listGradingJobs(user.id),
      getGradingQuota(user.id, effectivePlanTier(user)),
    ]);
    return jsonOk({ jobs, quota });
  } catch (e) {
    return apiError(e);
  }
}
