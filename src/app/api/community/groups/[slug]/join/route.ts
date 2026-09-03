import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { joinGroup, leaveGroup } from "@/services/community-groups";
import { revalidateForum } from "../../../_shared/revalidate";

export const dynamic = "force-dynamic";

/** Gå med. Idempotent. Medlemsräknaren på gruppsidan är ISR → revalidera. */
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const result = await joinGroup(params.slug, user.id);
    revalidateForum({ group: true });
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}

/** Lämna. Idempotent. */
export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const result = await leaveGroup(params.slug, user.id);
    revalidateForum({ group: true });
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
