import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import { z } from "zod";
import { voteStoreReport } from "@/services/community";
import { STORE_REPORT_VOTES } from "@/lib/store-report-votes";
import { scheduleStoreReportSync } from "@/services/store-report-discord";
import { revalidateForum } from "../../../_shared/revalidate";

export const dynamic = "force-dynamic";

// Tom kropp = CONFIRM: klienter ur förra bygget (WebView-cachad JS) skickar ingen.
const voteSchema = z.object({ kind: z.enum(STORE_REPORT_VOTES).default("CONFIRM") });

/** Röstar "stämmer fortfarande"/"inte längre" på en butiksrapport och redigerar Discord-inlägget. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const { ok } = await rateLimit(`community-confirm:${user.id}`, 30, 10 * 60 * 1000);
    if (!ok) throw new ServiceError(429, "För många förfrågningar. Försök igen om en stund.");
    // Per rapport: räcker för "fanns, slut, fylldes på" men inte för att vippa för nöjes skull.
    // Räknaren ligger i minnet/Redis — ingen databasfråga.
    const perReport = await rateLimit(`community-vote:${user.id}:${params.id}`, 4, 60 * 60 * 1000);
    if (!perReport.ok) {
      throw new ServiceError(429, "Du har redan uppdaterat den här rapporten flera gånger. Försök igen om en stund.");
    }
    const { kind } = voteSchema.parse(await req.json().catch(() => ({})));
    const result = await voteStoreReport(params.id, user.id, kind);
    revalidateForum({ group: true, thread: true });
    // Samma Discord-meddelande redigeras (aldrig ett nytt), samlat ~10 s efter sista rösten.
    scheduleStoreReportSync(params.id);
    return jsonOk(result);
  } catch (e) {
    return apiError(e);
  }
}
