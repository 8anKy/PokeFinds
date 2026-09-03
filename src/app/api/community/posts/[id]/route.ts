import { z } from "zod";
import { ListingStatus } from "@prisma/client";
import { apiError, jsonOk } from "@/lib/api";
import { auth, requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { deleteImage } from "@/lib/object-storage";
import { deletePost, getPost, setListingStatus } from "@/services/community";
import { revalidateForum } from "../../_shared/revalidate";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  listingStatus: z.nativeEnum(ListingStatus),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    await assertCommunityV2(session?.user?.role ?? null);
    const post = await getPost(params.id);
    return jsonOk(post);
  } catch (e) {
    return apiError(e);
  }
}

/** Annonsstatus (Aktiv/Såld/Avslutad). Ägaren fritt, moderator+ bara CLOSED. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const { listingStatus } = patchSchema.parse(await req.json());
    const result = await setListingStatus(params.id, user.id, user.role, listingStatus);
    revalidateForum({ group: true, thread: true });
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const result = await deletePost(params.id, user.id, user.role);
    revalidateForum({ group: true, thread: true });
    // Städa lagringen EFTER raden är borta. Best effort: en kvarglömd fil kostar
    // ett halvt öre i månaden, en tråd som inte går att radera kostar förtroende.
    await Promise.all(
      result.imageKeys.map((key) =>
        deleteImage(key).catch((err) =>
          console.error("[community] kunde inte radera bild:", err instanceof Error ? err.message : err)
        )
      )
    );
    return jsonOk({ deleted: true });
  } catch (e) {
    return apiError(e);
  }
}
