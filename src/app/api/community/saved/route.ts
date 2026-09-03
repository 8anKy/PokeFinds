import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCommunityV2 } from "@/lib/community-v2-server";
import { getLikedFeed, getSavedFeed } from "@/services/community";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["saved", "liked"]).default("saved"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Betraktarens sparade resp. gillade trådar — sidorna efter den första på
 * /forum/sparade. Alltid personligt ⇒ kräver konto (401 skickar apiFetch till
 * inloggningen, vilket är rätt här till skillnad från /api/community/me).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await assertCommunityV2(user.role);
    const p = schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const feed =
      p.kind === "saved"
        ? await getSavedFeed(user.id, p.page, p.pageSize)
        : await getLikedFeed(user.id, p.page, p.pageSize);
    return jsonOk(feed);
  } catch (e) {
    return apiError(e);
  }
}
