import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { acceptForumRules } from "@/lib/forum-rules";

export const dynamic = "force-dynamic";

/** Användaren godkänner forumets regler (dialogen i ForumRulesGate). Idempotent. */
export async function POST() {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const { acceptedAt } = await acceptForumRules(user.id);
    return jsonOk({ acceptedAt: acceptedAt.toISOString() });
  } catch (e) {
    return apiError(e);
  }
}
