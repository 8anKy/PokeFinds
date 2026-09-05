import type { NextRequest } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { auth } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { personalPostState } from "@/services/community";
import { joinedGroupIds } from "@/services/community-groups";
import { blockedUserIds } from "@/services/blocks";
import { hasAcceptedForumRules } from "@/lib/forum-rules";

export const dynamic = "force-dynamic";

const MAX_POST_IDS = 50;

/**
 * Betraktarens personliga tillstånd för ISR-sidorna (kontrakt 5 i briefen):
 * gillat/sparat bland `?postIds=a,b,c`, grupper hen gått med i, och blockerade
 * användare (åt båda hållen — svaren döljs i klienten).
 *
 * Utloggad ⇒ 200 med tomma listor, aldrig 401: sidan är publik, och ett 401
 * hade fått apiFetch att skicka besökaren till inloggningen. Klienten ska
 * ändå inte anropa rutten utan `fo_auth`-hinten — det här är golvet.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    await assertCommunityV2(session?.user?.role ?? null);
    const userId = session?.user?.id;
    // rulesAccepted: null = okänt (utloggad), annars om forumreglerna är godkända.
    const empty = {
      likedIds: [],
      savedIds: [],
      joinedGroupIds: [],
      blockedIds: [],
      rulesAccepted: null as boolean | null,
    };
    if (!userId) return jsonOk(empty);

    const postIds = (req.nextUrl.searchParams.get("postIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s))
      .slice(0, MAX_POST_IDS);

    const [state, groups, blocked, rulesAccepted] = await Promise.all([
      personalPostState(userId, postIds),
      joinedGroupIds(userId),
      blockedUserIds(userId),
      hasAcceptedForumRules(userId),
    ]);
    return jsonOk({
      likedIds: state.likedIds,
      savedIds: state.savedIds,
      joinedGroupIds: groups,
      blockedIds: blocked,
      rulesAccepted,
    });
  } catch (e) {
    return apiError(e);
  }
}
