/**
 * Min personliga inbjudningslänk (lib/invite-link.ts) — trycks på delningsbilderna.
 * Koden skapas lat första gången. 401 för gäster ⇒ bilden visar bara foilio.se.
 */
import { requireUser } from "@/lib/auth";
import { apiError, jsonOk } from "@/lib/api";
import { inviteLinkLabel, inviteLinkUrl } from "@/lib/invite-link";
import { getOrCreateInviteCode } from "@/services/invites";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const code = await getOrCreateInviteCode(user.id);
    return jsonOk({ code, label: inviteLinkLabel(code), url: inviteLinkUrl(code) });
  } catch (e) {
    return apiError(e);
  }
}
