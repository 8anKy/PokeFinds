/** GET /api/scanner/jobs — användarens senaste skanningar. */
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listScannerJobs } from "@/services/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const jobs = await listScannerJobs(user.id, 10);
    return jsonOk({ jobs });
  } catch (e) {
    return apiError(e);
  }
}
