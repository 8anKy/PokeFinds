import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { removeSetWatch } from "@/services/set-watch";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { setId: string } }
) {
  try {
    const user = await requireUser();
    const result = await removeSetWatch(user.id, params.setId);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
