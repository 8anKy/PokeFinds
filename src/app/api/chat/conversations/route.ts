import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { getOrCreateConversation, listConversations } from "@/services/chat";

export const dynamic = "force-dynamic";

/** Mina samtal, senast aktiva först. */
export async function GET() {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const rows = await listConversations(user.id);
    return jsonOk(rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  userId: z.string().min(1).max(64),
  postId: z.string().min(1).max(64).optional(),
});

/**
 * Kontrakt (delas med forumets "Skicka meddelande"-knapp): `{ userId, postId? }`
 * → 201 `{ id }`. Befintligt samtal returneras med samma form — klienten
 * navigerar till /meddelanden/<id> oavsett.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = createSchema.parse(await req.json());
    const { id } = await getOrCreateConversation(user.id, input.userId, input.postId);
    return jsonOk({ id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
