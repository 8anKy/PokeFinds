import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { assertForumRulesAccepted, logModerationEvent } from "@/lib/forum-rules";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { findProfanity, PROFANITY_CODE } from "@/lib/profanity";
import { storeSuggestionSchema } from "@/lib/community-stores";
import { suggestCommunityStore } from "@/services/community-stores";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    await assertForumRulesAccepted(user.id);
    const { ok } = await rateLimit(`community-store:${user.id}`, 5, 86400000);
    if (!ok) throw new ServiceError(429, "För många butiksförslag. Försök igen i morgon.");
    const input = storeSuggestionSchema.parse(await req.json());
    const dirty = findProfanity(`${input.name} ${input.address} ${input.city}`);
    if (dirty) {
      logModerationEvent(user.id, "POST", dirty);
      throw new ServiceError(400, "Inlägget innehåller ord som inte är tillåtna i forumet. Ändra texten och försök igen.", PROFANITY_CODE);
    }
    return jsonOk(await suggestCommunityStore(user.id, input), { status: 201 });
  } catch (e) { return apiError(e); }
}
