import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { toggleSave } from "@/services/community";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const result = await toggleSave(params.id, user.id);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
