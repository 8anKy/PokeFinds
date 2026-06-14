/** GET /api/grading/jobs — användarens senaste graderingar + dagens kvot. */
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getGradingQuota, listGradingJobs } from "@/services/grading";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const [jobs, quota] = await Promise.all([
      listGradingJobs(user.id),
      getGradingQuota(user.id, user.planTier),
    ]);
    return jsonOk({ jobs, quota });
  } catch (e) {
    return apiError(e);
  }
}
