import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { MESSAGES_PAGE_MAX } from "@/lib/chat-rules";
import { getConversationForUser, listMessages, sendMessage } from "@/services/chat";

export const dynamic = "force-dynamic";

const listSchema = z
  .object({
    after: z.string().min(1).max(64).optional(),
    before: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGES_PAGE_MAX).optional(),
  })
  .refine((q) => !(q.after && q.before), { message: "Ange after ELLER before." });

/** Meddelanden i stigande tidsordning: `?after=<id>` (nyare) eller `?before=<id>` (äldre sida). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const url = new URL(req.url);
    const query = listSchema.parse({
      after: url.searchParams.get("after") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    // Utomstående får 404, aldrig 403 — samtalet "finns inte" för dem.
    const conv = await getConversationForUser(params.id, user.id);
    if (!conv) throw new ServiceError(404, "Samtalet hittades inte.");
    const messages = await listMessages(conv.id, query);
    return jsonOk(messages, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

const sendSchema = z.object({ body: z.string() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = sendSchema.parse(await req.json());
    const message = await sendMessage(params.id, { id: user.id, name: user.name }, input.body);
    return jsonOk(message, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
