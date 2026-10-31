/**
 * Min inbjudan. GET = min kod (den jag delar), vem som bjöd in mig och om jag
 * fortfarande kan skriva in en kod. POST { code } = skriv in en väns kod i
 * efterhand (services/invites.ts → redeemInviteCode, spärrarna står där).
 */
import { z } from "zod";
import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getMyInviteStatus, redeemInviteCode } from "@/services/invites";
import { inviteLinkUrl } from "@/lib/invite-link";
import { discordLinkingEnabled } from "@/lib/discord";

export const dynamic = "force-dynamic";

const redeemSchema = z.object({ code: z.string().trim().min(1).max(32) });

/** + länken att dela och om "Koppla Discord" finns (onboardingens Discord-val). */
async function payload(userId: string) {
  const status = await getMyInviteStatus(userId);
  return { ...status, url: inviteLinkUrl(status.code), discordLinking: discordLinkingEnabled() };
}

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await payload(user.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { code } = redeemSchema.parse(await req.json());
    // Inbjudarens lott kommer först när vännen återvänt en annan dag — ingen cache att tömma nu.
    await redeemInviteCode(user.id, code);
    return jsonOk(await payload(user.id));
  } catch (e) {
    return apiError(e);
  }
}
