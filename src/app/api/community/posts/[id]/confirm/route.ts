import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { toggleStoreReportConfirm } from "@/services/community";
import { syncStoreReportToDiscord } from "@/services/store-report-discord";
import { revalidateForum } from "../../../_shared/revalidate";

export const dynamic = "force-dynamic";

/** Växlar "jag ser den också" på en butiksrapport och uppdaterar Discord-inlägget. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const { ok } = await rateLimit(`community-confirm:${user.id}`, 30, 10 * 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar. Försök igen om en stund.");
    const result = await toggleStoreReportConfirm(params.id, user.id);
    revalidateForum({ group: true, thread: true });
    // Fire-and-forget: samma Discord-meddelande redigeras, inget nytt postas.
    void syncStoreReportToDiscord(params.id).catch((err) =>
      console.error("[community] butikslarm-uppdatering misslyckades:", err)
    );
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
