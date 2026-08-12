/**
 * Kreatörskoder: uppslag vid registrering + statistiken du betalar kreatörer på.
 *
 * Se lib/creator-ref.ts för hur koden tar sig från TikTok-länken hit, och
 * schema.prisma för varför attribution och rabatt är TVÅ skilda saker.
 */
import { prisma } from "@/lib/db";
import { normalizeCreatorCode } from "@/lib/creator-ref";
import { proUserWhere } from "@/lib/plan";

/**
 * Slå upp en AKTIV kod. Returnerar null för okänd, avstängd eller trasig kod.
 *
 * ⛔ Får ALDRIG kasta uppåt i registreringsflödet — en dålig kod är en
 * marknadsföringsdetalj, ett misslyckat kontoskapande är en förlorad användare.
 * Samma hållning som inbjudningskoden (services/invites.ts).
 */
export async function resolveCreatorCode(raw: string | null | undefined) {
  const code = normalizeCreatorCode(raw);
  if (!code) return null;
  try {
    return await prisma.creatorCode.findFirst({
      where: { code, isActive: true },
      select: { id: true, code: true, creatorName: true },
    });
  } catch (e) {
    console.error("[creator-codes] uppslag misslyckades:", e);
    return null;
  }
}

/**
 * Promotion code-id:t som ska förifyllas i kassan för en användare, om något.
 * Null när användaren är organisk, koden saknar Stripe-koppling eller är avstängd.
 *
 * ⚠️ Avstängd kod slutar ge rabatt även för redan attribuerade användare. Det är
 * med flit: kampanjen är slut när den är slut. Attributionen (vem som värvade
 * kontot) påverkas inte — den är historik och betalas ut ändå.
 */
export async function checkoutPromotionCodeFor(userId: string): Promise<string | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        creatorCode: {
          select: { stripePromotionCodeId: true, isActive: true },
        },
      },
    });
    const cc = user?.creatorCode;
    if (!cc || !cc.isActive) return null;
    return cc.stripePromotionCodeId || null;
  } catch (e) {
    console.error("[creator-codes] kunde inte läsa rabattkoden:", e);
    return null;
  }
}

export interface CreatorCodeStats {
  id: string;
  code: string;
  creatorName: string;
  channel: string | null;
  note: string | null;
  stripePromotionCodeId: string | null;
  isActive: boolean;
  createdAt: Date;
  /** Konton skapade via kodens länk — talet kreatören betalas på. */
  signups: number;
  /** Hur många av dem som har Pro NU (via valfri källa: Stripe, app, bonus, roll). */
  proNow: number;
  /** Hur många som betalar oss direkt via Stripe just nu (delmängd av proNow). */
  stripeNow: number;
  /** Senaste registreringen — visar om länken fortfarande lever. */
  lastSignupAt: Date | null;
}

/**
 * Allt adminvyn behöver, en fråga per mått i stället för en per kod.
 *
 * ⛔ `proUserWhere()` (inte `planTier: PREMIUM`) — annars räknas varken
 * webbprenumeranter, referral-Pro eller admins, och en kreatör vars publik köper
 * via kort hade sett ut att inte konvertera alls. Se lib/plan.ts.
 */
export async function getCreatorCodeStats(): Promise<CreatorCodeStats[]> {
  const [codes, signupGroups, proGroups, stripeGroups] = await Promise.all([
    prisma.creatorCode.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
    prisma.user.groupBy({
      by: ["creatorCodeId"],
      where: { creatorCodeId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.user.groupBy({
      by: ["creatorCodeId"],
      where: { creatorCodeId: { not: null }, ...proUserWhere() },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["creatorCodeId"],
      where: { creatorCodeId: { not: null }, stripeProUntil: { gt: new Date() } },
      _count: { _all: true },
    }),
  ]);

  const signups = new Map(signupGroups.map((g) => [g.creatorCodeId, g]));
  const pro = new Map(proGroups.map((g) => [g.creatorCodeId, g._count._all]));
  const stripe = new Map(stripeGroups.map((g) => [g.creatorCodeId, g._count._all]));

  return codes.map((c) => ({
    id: c.id,
    code: c.code,
    creatorName: c.creatorName,
    channel: c.channel,
    note: c.note,
    stripePromotionCodeId: c.stripePromotionCodeId,
    isActive: c.isActive,
    createdAt: c.createdAt,
    signups: signups.get(c.id)?._count._all ?? 0,
    proNow: pro.get(c.id) ?? 0,
    stripeNow: stripe.get(c.id) ?? 0,
    lastSignupAt: signups.get(c.id)?._max.createdAt ?? null,
  }));
}
