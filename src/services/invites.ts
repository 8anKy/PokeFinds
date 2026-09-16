/**
 * Inbjudningar (#10): bjud in 3 vänner som skapar NYA konton och verifierar sin
 * e-post → 1 månad Pro till inviter (User.bonusProUntil, separat från RevenueCats
 * planTier så en EXPIRATION-webhook aldrig kan nolla en intjänad bonus).
 *
 * Koden är ENGÅNGS: den förbrukas (usedById sätts) vid registrering, som är den
 * ENDA inlösningsvägen — befintliga konton kan inte lösa in en inbjudan.
 * Belöningen delas ut i verify-flödet: varje gång en inbjuden användare
 * bekräftar sin mejl grupperas inviterns verifierade-men-obetalda inbjudningar;
 * fulla 3-grupper markeras rewardedAt (dubbelutbetalningsspärr, atomär via
 * updateMany-count) och bonusen förlängs en månad.
 */
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { proRewardEmail } from "@/emails/templates";
import { syncDiscordRoles } from "@/services/discord-sync";

export const INVITES_REQUIRED = 3;

/**
 * ÅTERBESÖKSGRINDEN (2026-09-17). En inbjuden räknas först när kontot varit
 * inne EN SENARE UTC-DAG än det skapades. Bakgrund: en användare skapade tre
 * konton på sex minuter (egna adresser), bekräftade mejlen och fick månaden —
 * verifieringen kostar fem minuter, återbesöket är det en fejk aldrig gör.
 * ⛔ Ingen IP-/enhetsheuristik (VPN, familjens delade telefon = falska
 * positiva) och inget aktivitetskrav (en vän som bara tittar räknas).
 * Ren funktion — testad.
 */
export function inviteeReturned(
  invitee: { createdAt: Date; lastSeenAt: Date | null } | null | undefined
): boolean {
  if (!invitee?.lastSeenAt) return false;
  return utcDay(invitee.lastSeenAt) > utcDay(invitee.createdAt);
}

/** Är det här FÖRSTA gången kontot ses en senare dag? Den enda stunden grinden kan öppnas. */
export function isFirstReturn(
  user: { createdAt: Date; lastSeenAt: Date | null },
  now: Date
): boolean {
  return utcDay(now) > utcDay(user.createdAt) && !inviteeReturned(user);
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Max olösta koder per användare — spärr mot länkspam, inte en produktgräns. */
export const MAX_OPEN_INVITES = 10;

/**
 * ENGÅNGSERBJUDANDE (ägarbeslut 2026-07-19): en användare kan tjäna belöningen
 * EN gång. Efter utbetalning försvinner invite-sektionen ur kontot och varken
 * nya koder eller nya belöningar kan skapas.
 */
export async function hasEarnedReward(userId: string): Promise<boolean> {
  const n = await prisma.invite.count({
    where: { inviterId: userId, rewardedAt: { not: null } },
  });
  return n > 0;
}

/**
 * Ren funktion: nytt bonus-t.o.m.-datum. Förlänger en aktiv bonus från dess
 * slutdatum (staplar), annars en månad från nu. Exporterad för test.
 */
export function extendBonus(current: Date | null, now: Date): Date {
  const base = current && current.getTime() > now.getTime() ? new Date(current) : new Date(now);
  base.setMonth(base.getMonth() + 1);
  return base;
}

/**
 * Lös in en inbjudningskod vid registrering. Atomär engångs-inlösen:
 * updateMany med usedById=null → en redan använd/ogiltig kod är ett no-op
 * (registreringen ska ALDRIG stoppas av en dålig kod).
 */
export async function redeemInviteAtRegistration(
  code: string,
  newUserId: string
): Promise<boolean> {
  const res = await prisma.invite.updateMany({
    where: { id: code, usedById: null },
    data: { usedById: newUserId, usedAt: new Date() },
  });
  return res.count === 1;
}

/**
 * Körs när en användare bekräftat sin e-post: markera ev. inbjudan verifierad
 * och dela ut belöning till invitern om en full 3-grupp uppstått.
 */
export async function creditInviteOnVerify(verifiedUserId: string): Promise<void> {
  const invite = await prisma.invite.findUnique({
    where: { usedById: verifiedUserId },
    select: { id: true, inviterId: true, verifiedAt: true },
  });
  if (!invite || invite.verifiedAt) return;
  await prisma.invite.update({
    where: { id: invite.id },
    data: { verifiedAt: new Date() },
  });

  await tryRewardInviter(invite.inviterId);
}

/**
 * Körs första gången en inbjuden användare ses en senare dag (auth.ts, i samma
 * andetag som lastSeenAt bumpas). Det är då återbesöksgrinden öppnas.
 */
export async function creditInviteOnReturn(returnedUserId: string): Promise<void> {
  const invite = await prisma.invite.findUnique({
    where: { usedById: returnedUserId },
    select: { inviterId: true, verifiedAt: true, rewardedAt: true },
  });
  if (!invite || !invite.verifiedAt || invite.rewardedAt) return;
  await tryRewardInviter(invite.inviterId);
}

/**
 * Dela ut belöning till invitern om en full 3-grupp uppstått: verifierade,
 * obetalda OCH återbesökta inbjudningar (se inviteeReturned).
 */
async function tryRewardInviter(inviterId: string): Promise<void> {
  // Engångs: har invitern redan fått sin månad delas ingen ny belöning ut.
  if (await hasEarnedReward(inviterId)) return;

  const candidates = await prisma.invite.findMany({
    where: { inviterId, verifiedAt: { not: null }, rewardedAt: null },
    orderBy: { verifiedAt: "asc" },
    select: { id: true, usedBy: { select: { createdAt: true, lastSeenAt: true } } },
  });
  const group = candidates.filter((c) => inviteeReturned(c.usedBy)).slice(0, INVITES_REQUIRED);
  if (group.length < INVITES_REQUIRED) return;

  const now = new Date();
  const granted = await prisma.$transaction(async (tx) => {
    // Atomär spärr: markera gruppen; hann en parallell utdelning före är
    // count < 3 och DENNA process delar inte ut något (den andra gjorde det).
    const marked = await tx.invite.updateMany({
      where: { id: { in: group.map((g) => g.id) }, rewardedAt: null },
      data: { rewardedAt: now },
    });
    if (marked.count < INVITES_REQUIRED) return null;
    const inviter = await tx.user.findUnique({
      where: { id: inviterId },
      select: { name: true, email: true, bonusProUntil: true },
    });
    if (!inviter) return null;
    const until = extendBonus(inviter.bonusProUntil, now);
    await tx.user.update({
      where: { id: inviterId },
      data: { bonusProUntil: until },
    });
    return { name: inviter.name, email: inviter.email, until };
  });

  if (granted) {
    // Referral-Pro är en av de fyra Pro-källorna i isPro() — utan det här syns
    // den inte i Discord förrän nattens avstämning. ⛔ UTANFÖR transaktionen:
    // ett HTTP-anrop mot Discord hör inte hemma i en DB-transaktion (den hålls
    // öppen medan vi väntar på ett nätverkssvar).
    await syncDiscordRoles(inviterId, "Foilio: Pro via inbjudningar");
    try {
      await sendMail({ to: granted.email, ...proRewardEmail(granted.name, granted.until) });
    } catch (e) {
      console.error("Kunde inte skicka Pro-belöningsmejl:", e);
    }
  }
}

/** Inviterns översikt för /mer/bjud-in. */
export async function getInviteStatus(userId: string) {
  const [invites, user] = await Promise.all([
    prisma.invite.findMany({
      where: { inviterId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        usedAt: true,
        verifiedAt: true,
        rewardedAt: true,
        usedBy: { select: { name: true, createdAt: true, lastSeenAt: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { bonusProUntil: true },
    }),
  ]);
  // Framsteg = verifierad OCH återbesökt (återbesöksgrinden), aldrig bara verifierad.
  const verifiedUnrewarded = invites.filter(
    (i) => i.verifiedAt && !i.rewardedAt && inviteeReturned(i.usedBy)
  ).length;
  return {
    invites: invites.map((i) => ({
      id: i.id,
      createdAt: i.createdAt,
      usedAt: i.usedAt,
      verifiedAt: i.verifiedAt,
      rewardedAt: i.rewardedAt,
      usedByName: i.usedBy?.name ?? null,
      /** Har den inbjudna varit inne en senare dag? Verifierad utan detta räknas inte än. */
      returned: inviteeReturned(i.usedBy),
    })),
    /** Framsteg mot belöningen (0–2; 3 delas ut direkt). */
    progress: verifiedUnrewarded,
    required: INVITES_REQUIRED,
    bonusProUntil: user?.bonusProUntil ?? null,
    /** Engångs: belöningen är uttagen → sektionen ska inte visas/användas. */
    earned: invites.some((i) => i.rewardedAt != null),
  };
}

/** Skapa en ny engångskod. Nekas efter uttagen belöning (engångs) och vid spam-tak. */
export async function createInvite(
  userId: string
): Promise<{ code: string } | { error: "earned" | "cap" }> {
  if (await hasEarnedReward(userId)) return { error: "earned" };
  const open = await prisma.invite.count({
    where: { inviterId: userId, usedById: null },
  });
  if (open >= MAX_OPEN_INVITES) return { error: "cap" };
  const invite = await prisma.invite.create({
    data: { inviterId: userId },
    select: { id: true },
  });
  return { code: invite.id };
}
