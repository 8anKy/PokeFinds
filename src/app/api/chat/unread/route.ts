import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { unreadConversationCount } from "@/services/chat";

export const dynamic = "force-dynamic";

/** `{ count }` = antal samtal med olästa meddelanden. Klienten cachar 60 s (UnreadBadge). */
export async function GET() {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const count = await unreadConversationCount(user.id);
    return jsonOk({ count }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
