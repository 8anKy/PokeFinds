import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { addComment, listComments } from "@/services/community";

export const dynamic = "force-dynamic";

const commentSchema = z.object({
  content: z.string().trim().min(1, "Kommentaren får inte vara tom.").max(5000),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const comments = await listComments(params.id);
    return jsonOk({ items: comments });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();

    const { ok } = await rateLimit(`community-comment:${user.id}`, 20, 10 * 60 * 1000);
    if (!ok) {
      throw new ServiceError(
        429,
        "Du har kommenterat för många gånger på kort tid. Försök igen om en stund."
      );
    }

    const { content } = commentSchema.parse(await req.json());
    const comment = await addComment(params.id, user.id, content);
    return jsonOk(comment, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
