import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { FORUM_RULES_CODE } from "@/lib/profanity";

/**
 * FORUMETS REGLER — GODKÄNNANDET (ägarbeslut 2026-09-05, "like Collectr").
 *
 * `User.forumRulesAcceptedAt` är tidpunkten då användaren godkände reglerna i
 * dialogen (`ForumRulesGate`). NULL = inte godkänt. Grinden ligger på SERVERN, vid
 * skrivningen (tråd, svar): dialogen är bekvämlighet, det här är regeln — en
 * klient som hoppar över dialogen får 403 med koden `FORUM_RULES`, och klienten
 * öppnar dialogen igen på den koden. Läsning är fri: reglerna handlar om vad man
 * skriver, inte om vad man får se.
 */
export async function assertForumRulesAccepted(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumRulesAcceptedAt: true },
  });
  if (!user?.forumRulesAcceptedAt) {
    throw new ServiceError(
      403,
      "Godkänn forumets regler innan du skriver.",
      FORUM_RULES_CODE
    );
  }
}

/** Idempotent: ett andra godkännande skriver inte över det första datumet. */
export async function acceptForumRules(userId: string): Promise<{ acceptedAt: Date }> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumRulesAcceptedAt: true },
  });
  if (current?.forumRulesAcceptedAt) return { acceptedAt: current.forumRulesAcceptedAt };
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { forumRulesAcceptedAt: new Date() },
    select: { forumRulesAcceptedAt: true },
  });
  return { acceptedAt: updated.forumRulesAcceptedAt as Date };
}

export async function hasAcceptedForumRules(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumRulesAcceptedAt: true },
  });
  return !!user?.forumRulesAcceptedAt;
}
