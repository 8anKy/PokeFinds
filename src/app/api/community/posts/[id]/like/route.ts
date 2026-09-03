import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { toggleLike } from "@/services/community";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const result = await toggleLike(params.id, user.id);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
