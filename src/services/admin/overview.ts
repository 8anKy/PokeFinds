/**
 * Adminöversiktens nyckeltal — allt som ska gå att se på EN sida.
 *
 * ⛔ EN RUNDTUR, INTE TRETTIO. Alla skalärer ligger i ETT `$transaction` och
 * tidsserierna i tre `date_trunc`-frågor. Sidan är `force-dynamic` och besöks
 * sällan, men Neon debiteras per VAKEN TID (minst 300 s per väckning) — en vy som
 * gör en fråga per siffra håller computen vaken i onödan varje gång någon råkar
 * öppna admin. Samma regel som gäller nattjobben gäller här.
 *
 * ⛔ RÅ SQL FÖR "HUR MÅNGA ANVÄNDARE HAR MINST EN X". Prismas `groupBy(["userId"])`
 * hämtar HELA grupplistan till Node bara för att `.length` ska gå att läsa — 2 615
 * skannerrader för att få fram talet 55. `count(distinct "userId")` gör jobbet i
 * databasen och skickar ett heltal.
 */
import { prisma } from "@/lib/db";
import { payingUserWhere } from "@/lib/plan";

/** Månadspris i öre. Samma tal som prissidan visar. */
export const PRO_PRICE_ORE = 4900;

/**
 * App Store och Google Play tar 15 % i Small Business Program.
 * ⛔ Bruttot är INTE intäkten. Visas som eget tal i vyn, aldrig hopblandat.
 */
export const STORE_CUT = 0.15;

export interface DailyPoint {
  /** YYYY-MM-DD, UTC-dygn — samma nyckel som resten av systemet (se `utcToday()`). */
  date: string;
  value: number;
}

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** Vad steget betyder. Hör hemma i tooltipen, inte som brödtext under grafen. */
  hint: string;
}

export interface InviteEdge {
  id: string;
  inviterName: string;
  inviterEmail: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  createdAt: Date;
  usedAt: Date | null;
  verifiedAt: Date | null;
  rewardedAt: Date | null;
}

export interface PayingUserRow {
  id: string;
  name: string;
  email: string;
  /** "store" = App Store/Google Play (planTier), "stripe" = webben. */
  channel: "store" | "stripe";
  stripeUntil: Date | null;
  createdAt: Date;
  watchlistCount: number;
  collectionCount: number;
  lastSeenAt: Date | null;
}

export async function getAdminOverview() {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d30 = new Date(now.getTime() - 30 * 864e5);

  const [
    users,
    usersNew7d,
    usersNew30d,
    usersVerified,
    usersOnboarded,
    active7d,
    active30d,
    neverSeen,
    paying,
    payingStore,
    payingStripe,
    bonusPro,
    adminPro,
    invitesCreated,
    invitesUsed,
    invitesVerified,
    invitesRewarded,
    pushUsers,
    discordLinked,
    creatorAttributed,
    scannerJobs30d,
    gradingJobs30d,
    alerts30d,
    openReports,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.user.count({ where: { createdAt: { gte: d30 } } }),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { onboardingCompleted: true } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d7 } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d30 } } }),
    prisma.user.count({ where: { lastSeenAt: null } }),
    prisma.user.count({ where: payingUserWhere(now) }),
    prisma.user.count({ where: { ...payingUserWhere(now), planTier: "PREMIUM" } }),
    prisma.user.count({ where: { ...payingUserWhere(now), stripeProUntil: { gt: now } } }),
    // ⛔ MÅSTE VARA ÖMSESIDIGT UTESLUTANDE — ringen påstår att delarna summerar
    //    till helheten. Ett konto med både bonus och betalning hade annars
    //    räknats två gånger och fått ringen att visa >100 %.
    prisma.user.count({
      where: {
        role: { notIn: ["ADMIN", "SUPERADMIN"] },
        planTier: { not: "PREMIUM" },
        stripeProUntil: null,
        bonusProUntil: { gt: now },
      },
    }),
    prisma.user.count({ where: { role: { in: ["ADMIN", "SUPERADMIN"] } } }),
    prisma.invite.count(),
    prisma.invite.count({ where: { usedById: { not: null } } }),
    prisma.invite.count({ where: { verifiedAt: { not: null } } }),
    prisma.invite.count({ where: { rewardedAt: { not: null } } }),
    prisma.pushToken.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.user.count({ where: { discordUserId: { not: null } } }),
    prisma.user.count({ where: { creatorCodeId: { not: null } } }),
    prisma.scannerJob.count({ where: { createdAt: { gte: d30 } } }),
    prisma.gradingJob.count({ where: { createdAt: { gte: d30 } } }),
    prisma.alert.count({ where: { triggeredAt: { gte: d30 } } }),
    prisma.report.count({ where: { status: "OPEN" } }),
  ]);

  // "Har minst en X" + notisräckvidd — allt i EN fråga, allt räknat i databasen.
  const [reach] = await prisma.$queryRawUnsafe<
    {
      watchers: number;
      collectors: number;
      scanners: number;
      emailOn: number;
      pushOn: number;
    }[]
  >(`
    select
      (select count(distinct "userId")::int from "WatchlistItem")  as watchers,
      (select count(distinct "userId")::int from "CollectionItem") as collectors,
      (select count(distinct "userId")::int from "ScannerJob")     as scanners,
      -- ⛔ coalesce(..., true): saknas nyckeln i JSON:en är e-post PÅ (schemats
      --    default). Ett bart ->>'email' = 'true' hade tyst räknat bort de
      --    äldsta kontona, som aldrig rört inställningarna.
      (select count(*)::int from "User"
         where coalesce((("notificationSettings")->>'email')::boolean, true))  as "emailOn",
      (select count(*)::int from "User"
         where coalesce((("notificationSettings")->>'push')::boolean, false))  as "pushOn"
  `);

  // Tidsserier, 90 dygn. Sajten är yngre än så, och en obegränsad serie hade
  // vuxit utan tak rakt in i klientens bundle.
  const [signupSeries, eventSeries, scanSeries] = await Promise.all([
    prisma.$queryRawUnsafe<DailyPoint[]>(`
      select to_char(date_trunc('day', "createdAt" at time zone 'UTC'), 'YYYY-MM-DD') as date,
             count(*)::int as value
      from "User"
      where "createdAt" >= now() - interval '90 days'
      group by 1 order by 1
    `),
    prisma.$queryRawUnsafe<{ date: string; eventType: string; value: number }[]>(`
      select to_char(date_trunc('day', "createdAt" at time zone 'UTC'), 'YYYY-MM-DD') as date,
             "eventType", count(*)::int as value
      from "AnalyticsEvent"
      where "createdAt" >= now() - interval '90 days'
      group by 1, 2 order by 1
    `),
    prisma.$queryRawUnsafe<DailyPoint[]>(`
      select to_char(date_trunc('day', "createdAt" at time zone 'UTC'), 'YYYY-MM-DD') as date,
             count(*)::int as value
      from "ScannerJob"
      where "createdAt" >= now() - interval '90 days'
      group by 1 order by 1
    `),
  ]);

  // Hur många konton fanns FÖRE fönstret? Utan det startar den kumulativa kurvan
  // på noll och påstår att sajten föddes för 90 dagar sedan.
  const usersBeforeWindow = users - signupSeries.reduce((sum, r) => sum + r.value, 0);

  const [inviteEdges, payingRows] = await Promise.all([
    prisma.invite.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        usedAt: true,
        verifiedAt: true,
        rewardedAt: true,
        inviter: { select: { name: true, email: true } },
        usedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.user.findMany({
      where: payingUserWhere(now),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        stripeProUntil: true,
        createdAt: true,
        lastSeenAt: true,
        _count: { select: { watchlistItems: true, collectionItems: true } },
      },
    }),
  ]);

  /**
   * ⛔ TRATTEN ÄR INGEN RANGORDNING — stegen är samma resa, och varje steg är
   * tänkt att vara en delmängd av det ovanför. Att en betalande kund kan sakna
   * bevakning (vilket båda gjorde i augusti 2026) är precis vad vyn ska göra
   * synligt: understa stapeln är inte automatiskt smalast av rätt skäl.
   */
  const funnel: FunnelStep[] = [
    { key: "signed", label: "Konton", value: users, hint: "Alla registrerade konton." },
    {
      key: "verified",
      label: "Verifierad e-post",
      value: usersVerified,
      hint: "Har en bekräftad adress. Nya konton föds verifierade.",
    },
    {
      key: "scanned",
      label: "Skannat kort",
      value: reach.scanners,
      hint: "Skannern är den funktion flest faktiskt provar.",
    },
    {
      key: "collected",
      label: "Poster i samlingen",
      value: reach.collectors,
      hint: "Har sparat minst ett kort i sin samling.",
    },
    {
      key: "watching",
      label: "Bevakar något",
      value: reach.watchers,
      hint: "Minst en produkt i bevakningslistan — förutsättningen för varje larm.",
    },
    {
      key: "paying",
      label: "Betalar",
      value: paying,
      hint: "planTier=PREMIUM (app) eller aktiv Stripe-prenumeration (webb).",
    },
  ];

  /**
   * PLANFÖRDELNING — en partition av ALLA konton, inte överlappande mängder.
   * Gratis räknas ut som resten så summan alltid blir `users`; en direkt
   * count hade kunnat glida isär med de tre andra och ge en ring som inte går
   * ihop.
   */
  const planMix = [
    { key: "paying", label: "Betalande", value: paying },
    { key: "bonus", label: "Gratis Pro (inbjudningar)", value: bonusPro },
    { key: "admin", label: "Admin", value: adminPro },
    {
      key: "free",
      label: "Gratiskonto",
      value: Math.max(0, users - paying - bonusPro - adminPro),
    },
  ];

  /** Händelsemix senaste 30 dygnen — varje händelse har exakt EN typ. */
  const eventCutoff = d30.toISOString().slice(0, 10);
  const eventMix = new Map<string, number>();
  for (const row of eventSeries) {
    if (row.date < eventCutoff) continue;
    eventMix.set(row.eventType, (eventMix.get(row.eventType) ?? 0) + row.value);
  }

  return {
    planMix,
    eventMix: [...eventMix.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value),
    users: {
      total: users,
      new7d: usersNew7d,
      new30d: usersNew30d,
      verified: usersVerified,
      onboarded: usersOnboarded,
      active7d,
      active30d,
      neverSeen,
    },
    revenue: {
      paying,
      payingStore,
      payingStripe,
      /** Brutto per månad, i öre. ⛔ Butikens andel dras av separat i vyn. */
      mrrOre: paying * PRO_PRICE_ORE,
      /** Netto efter App Store/Play-avdrag på app-köpen. Stripe har egen avgift. */
      mrrNetOre: Math.round(
        payingStripe * PRO_PRICE_ORE + payingStore * PRO_PRICE_ORE * (1 - STORE_CUT)
      ),
      /** Har Pro men betalar inte: referral-bonus respektive admin-roll. */
      bonusPro,
      adminPro,
      conversion: users > 0 ? paying / users : 0,
    },
    reach: {
      watchers: reach.watchers,
      collectors: reach.collectors,
      scanners: reach.scanners,
      emailOn: reach.emailOn,
      pushOn: reach.pushOn,
      /** En push-token BEVISAR att appen är installerad. Frånvaro bevisar inget. */
      appInstalled: pushUsers.length,
      discordLinked,
      creatorAttributed,
    },
    invites: {
      created: invitesCreated,
      used: invitesUsed,
      verified: invitesVerified,
      rewarded: invitesRewarded,
      edges: inviteEdges.map(
        (i): InviteEdge => ({
          id: i.id,
          inviterName: i.inviter.name,
          inviterEmail: i.inviter.email,
          inviteeName: i.usedBy?.name ?? null,
          inviteeEmail: i.usedBy?.email ?? null,
          createdAt: i.createdAt,
          usedAt: i.usedAt,
          verifiedAt: i.verifiedAt,
          rewardedAt: i.rewardedAt,
        })
      ),
    },
    activity: { scannerJobs30d, gradingJobs30d, alerts30d, openReports },
    funnel,
    series: {
      signups: signupSeries,
      /** Konton som redan fanns när 90-dagarsfönstret börjar. */
      usersBeforeWindow,
      events: eventSeries,
      scans: scanSeries,
    },
    payingUsers: payingRows.map(
      (u): PayingUserRow => ({
        id: u.id,
        name: u.name,
        email: u.email,
        channel: u.stripeProUntil && u.stripeProUntil > now ? "stripe" : "store",
        stripeUntil: u.stripeProUntil ?? null,
        createdAt: u.createdAt,
        watchlistCount: u._count.watchlistItems,
        collectionCount: u._count.collectionItems,
        lastSeenAt: u.lastSeenAt,
      })
    ),
  };
}

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;
