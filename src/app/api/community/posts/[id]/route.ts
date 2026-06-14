import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { deletePost, getPost } from "@/services/community";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const post = await getPost(params.id, session?.user?.id);
    return jsonOk(post);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const result = await deletePost(params.id, user.id, user.role);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
