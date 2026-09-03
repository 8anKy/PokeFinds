import { apiError, jsonOk } from "@/lib/api";
import { auth } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { listGroups } from "@/services/community-groups";

export const dynamic = "force-dynamic";

/** Alla grupper med medlems- och trådräknare, i visningsordning. */
export async function GET() {
  try {
    const session = await auth();
    await assertCommunityV2(session?.user?.role ?? null);
    const items = await listGroups();
    return jsonOk({ items });
  } catch (e) {
    return apiError(e);
  }
}
