import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { pushToUser } from "@/lib/push-to-user";
import { assertForumRulesAccepted } from "@/lib/forum-rules";
import { findProfanity, PROFANITY_CODE } from "@/lib/profanity";
import { addComment, listComments } from "@/services/community";
import { revalidateForum } from "../../../_shared/revalidate";

export const dynamic = "force-dynamic";

const commentSchema = z.object({
  content: z.string().trim().min(1, "Svaret får inte vara tomt.").max(5000),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    await assertCommunityV2(session?.user?.role ?? null);
    const comments = await listComments(params.id);
    return jsonOk({ items: comments });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    await assertForumRulesAccepted(user.id);

    const { ok } = await rateLimit(`community-comment:${user.id}`, 20, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har svarat för många gånger på kort tid. Försök igen om en stund."
      );
    }

    const { content } = commentSchema.parse(await req.json());
    if (findProfanity(content)) {
      throw new ServiceError(
        400,
        "Svaret innehåller ord som inte är tillåtna i forumet. Ändra texten och försök igen.",
        PROFANITY_CODE
      );
    }
    const { comment, post } = await addComment(params.id, user.id, content);
    revalidateForum({ group: true, thread: true });

    // Push till trådskaparen — aldrig till den som svarar på sin egen tråd.
    // pushToUser respekterar användarens push-inställning och kastar aldrig.
    if (post.userId !== user.id) {
      const body = content.replace(/\s+/g, " ").trim();
      void pushToUser(post.userId, {
        title: `Nytt svar på "${post.title.length > 60 ? `${post.title.slice(0, 59)}…` : post.title}"`,
        body: body.length > 100 ? `${body.slice(0, 99)}…` : body,
        url: `/forum/t/${params.id}`,
      });
    }

    return jsonOk(comment, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
