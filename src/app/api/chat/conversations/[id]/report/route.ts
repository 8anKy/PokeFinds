import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { REPORT_REASON_MAX, REPORT_REASON_MIN } from "@/lib/chat-rules";
import { reportConversation } from "@/services/chat";

export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.string().trim().min(REPORT_REASON_MIN).max(REPORT_REASON_MAX),
});

/** Anmäl samtalet till moderatorerna — enda vägen in i ett privat samtal för admin. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const input = schema.parse(await req.json());
    const report = await reportConversation(params.id, user.id, input.reason);
    return jsonOk(report, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
