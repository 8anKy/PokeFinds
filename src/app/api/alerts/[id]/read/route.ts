import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { markRead } from "@/services/alerts";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const alert = await markRead(user.id, params.id);
    return jsonOk(alert);
  } catch (e) {
    return apiError(e);
  }
}
