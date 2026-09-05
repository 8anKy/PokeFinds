import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { FORUM_RULES_CODE } from "@/lib/profanity";
import { FORUM_RULES_VERSION } from "@/lib/forum-rules-version";

/** Godkänt = datum satt OCH versionen är den aktuella (äldre ⇒ fråga igen). */
function accepted(u: { forumRulesAcceptedAt: Date | null; forumRulesVersion: number | null } | null): boolean {
  return !!u?.forumRulesAcceptedAt && (u.forumRulesVersion ?? 0) >= FORUM_RULES_VERSION;
}

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
    select: { forumRulesAcceptedAt: true, forumRulesVersion: true },
  });
  if (!accepted(user)) {
    throw new ServiceError(
      403,
      "Godkänn forumets regler innan du skriver.",
      FORUM_RULES_CODE
    );
  }
}

/** Idempotent för samma version; en ny version skriver nytt datum + version. */
export async function acceptForumRules(userId: string): Promise<{ acceptedAt: Date }> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumRulesAcceptedAt: true, forumRulesVersion: true },
  });
  if (accepted(current)) return { acceptedAt: current!.forumRulesAcceptedAt as Date };
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { forumRulesAcceptedAt: new Date(), forumRulesVersion: FORUM_RULES_VERSION },
    select: { forumRulesAcceptedAt: true },
  });
  return { acceptedAt: updated.forumRulesAcceptedAt as Date };
}

export async function hasAcceptedForumRules(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumRulesAcceptedAt: true, forumRulesVersion: true },
  });
  return accepted(user);
}

/**
 * Logga ett stoppat försök (ordfiltret). Eld-och-glöm: får aldrig fälla svaret.
 * `detail` = det normaliserade ordet, aldrig texten.
 */
export function logModerationEvent(
  userId: string,
  target: "POST" | "COMMENT",
  detail: string | null
): void {
  void prisma.moderationEvent
    .create({ data: { userId, kind: "PROFANITY", target, detail } })
    .catch(() => {});
}
