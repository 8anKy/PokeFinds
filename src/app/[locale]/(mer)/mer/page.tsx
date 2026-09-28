import { Suspense } from "react";
import type { Metadata } from "next";
import type { Role } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth, hasRole } from "@/lib/auth";
import { readSessionLite } from "@/lib/session-lite";
import { previewAllowedFor } from "@/lib/feature-preview";
import { prisma } from "@/lib/db";
import { communityV2Request } from "@/lib/community-v2-server";
import {
  IconBell,
  IconMail,
  IconMedal,
  IconPanel,
  IconShield,
  IconSliders,
  IconChevronRight,
  IconInfo,
} from "@/components/ui/icons";
import { LogoutButton } from "./logout-button";
import { GuestMore } from "./guest-more";
import { FoilPanel, FollowTiles, MenuRow, Section, type MenuLink } from "./more-ui";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { listUserAchievements } from "@/services/achievements";
import { getScannerQuota } from "@/services/scanner";
import { unreadConversationCount } from "@/services/chat";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("More");
  return { title: t("metaTitle") };
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
        {value}
        {sub && <span className="text-sm text-ink-muted">{sub}</span>}
      </span>
      <span className="mt-[3px] text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
    </span>
  );
}

/**
 * KONTOKORTETS SIFFROR (medlem sedan, bevakningar, märken, skanningar kvar). Egen
 * async-komponent bakom <Suspense> sedan 2026-09-28: sidan ritas direkt ur
 * sessionscookien och bara siffrorna väntar på Neon — vid appstart sover databasen
 * och Mer-fliken stod annars blank i 2–3 s (p99, Railway). `auth()` HÄR, inte ur
 * cookien: skanningskvoten ska räknas på den färska planen.
 */
async function CardStats({ userId }: { userId: string }) {
  const [session, t, locale] = await Promise.all([auth(), getTranslations("More"), getLocale()]);
  const planTier = session?.user?.planTier ?? "FREE";
  const role = session?.user?.role ?? "USER";
  const [watchCount, achievements, quota, account] = await Promise.all([
    prisma.watchlistItem.count({ where: { userId } }),
    listUserAchievements(userId),
    getScannerQuota(userId, planTier, role),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
  ]);

  // ⛔ RÄKNA NIVÅER, INTE MÄRKEN. "Samlare" är tre nivåer (10/100/1000), så
  // nämnaren är 18 och inte 15 — annars kan täljaren passera nämnaren.
  const totalUnlockable = ACHIEVEMENTS.reduce((n, d) => n + d.tiers.length, 0);
  const memberSince = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(account?.createdAt ?? new Date());

  // ⛔ PRO SER "∞", INTE ETT TAL. Pro-taket (1000/mån) är ett SKYDD mot skenande
  // kostnad, inte en produktgräns: villkoren säger "skäligt bruk" och skannerns
  // egen Pro-badge visar ∞. Skriver den här sidan ut "996 kvar" har vi plötsligt
  // publicerat en gräns kunden aldrig fått se. Se services/scanner/index.ts.
  const unlimited = !!session?.user?.isPro || hasRole(role, "MODERATOR");

  return (
    <>
      <span className="mt-1 block text-[13px] leading-[18px] text-ink-muted">
        {t("memberSince", { since: memberSince })}
      </span>
      <span className="mt-[22px] grid grid-cols-3 gap-3 border-t border-ink/10 pt-4">
        <Stat value={String(watchCount)} label={t("statWatching")} />
        <Stat value={String(achievements.length)} sub={`/${totalUnlockable}`} label={t("statBadges")} />
        <Stat value={unlimited ? "∞" : String(quota.remaining)} label={t("statScans")} />
      </span>
    </>
  );
}

/** Samma rader och samma höjd, utan siffror — kortet hoppar inte när de kommer. */
function CardStatsFallback({ labels }: { labels: [string, string, string] }) {
  return (
    <>
      <span aria-hidden className="mt-1 block text-[13px] leading-[18px] text-ink-muted">
        &nbsp;
      </span>
      <span className="mt-[22px] grid grid-cols-3 gap-3 border-t border-ink/10 pt-4">
        {labels.map((label) => (
          <Stat key={label} value="–" label={label} />
        ))}
      </span>
    </>
  );
}

/** Meddelanderaden; olästa-pricken kommer när räkningen är gjord. */
async function MessagesRow({ link, userId }: { link: MenuLink; userId: string }) {
  const unread = await unreadConversationCount(userId);
  return <MenuRow link={{ ...link, dot: unread > 0 }} />;
}

/**
 * Engångserbjudande: har användaren redan fått sin belöning (någon invite
 * rewardedAt) försvinner inbjudningsraden ur kontot (ägarbeslut).
 */
async function InviteRow({ userId, label }: { userId: string; label: string }) {
  const rewarded = await prisma.invite.count({ where: { inviterId: userId, rewardedAt: { not: null } } });
  return rewarded > 0 ? null : <MenuRow link={{ href: "/mer/bjud-in", label }} />;
}

export default async function MerPage() {
  // Cookien, inte auth() — se lib/session-lite.ts och CardStats ovan.
  const session = await readSessionLite();
  const t = await getTranslations("More");
  // Gäst: ingen inloggningsvägg. Språk, om oss, villkor och Discord finns även
  // utan konto — inloggningen är en av raderna, inte hela sidan (QA 2026-09-05).
  if (!session) return <GuestMore />;
  const role = session.role as Role;
  const isAdmin = hasRole(role, "MODERATOR");
  // Pro-märket ritas ur cookien (≤ 30 min gammalt) — en etikett, ingen behörighet.
  const isPremium = session.isPro;
  const userId = session.id;

  // Meddelanden (community v2) — grindat tills ägaren testat, se lib/community-v2-gate.ts.
  // Läser bara headers + roll, ingen DB.
  const [communityV2, tA, tNav] = await Promise.all([
    communityV2Request(role),
    getTranslations("Achievements"),
    getTranslations("Nav"),
  ]);

  const name = session.name ?? t("defaultName");
  const messagesLink: MenuLink = { href: "/meddelanden", label: tNav("messages"), icon: IconMail };

  // ⛔ BEVAKNINGAR OCH MÄRKEN BÄR INGET TAL HÄR (ägarbeslut 2026-09-09): talen
  // står redan på kontokortet ovan, och samma siffra två gånger på en skärm gör
  // ingen av dem trovärdig. Kortet visar TILLSTÅNDET, listan är VÄGEN dit.
  const activity: MenuLink[] = [
    { href: "/bevakningar", label: t("watches"), icon: IconBell, tour: "watches-row" },
    { href: "/mer/utmarkelser", label: tA("title"), icon: IconMedal },
  ];

  const tools: MenuLink[] = [
    { href: "/gradera", label: t("grading"), icon: IconShield },
    { href: "/installningar", label: t("settings"), icon: IconSliders },
    ...(isAdmin ? [{ href: "/admin", label: t("admin"), icon: IconPanel }] : []),
    // Startar om appens guidade tur (lib/app-tour.ts) — bara där turen är öppen.
    ...(previewAllowedFor("APP_TOUR", { role: session.role, email: session.email })
      ? [{ href: "/produkter?guide=1", label: t("tourAgain"), icon: IconInfo }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-md space-y-[26px]">
      {/* Kontokortet ÄR sidans rubrik — "Mer / Hantera ditt konto och dina
          inställningar" sa inget som raderna under inte redan säger, och en
          rubrik som heter samma sak som fliken man just tryckte på är brus. */}
      <FoilPanel href="/installningar" foil={isPremium}>
        <span className="flex items-start justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {t("cardRole")}
          </span>
          <span className="rounded-full border border-ink/20 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
            {isPremium ? t("planChipPro") : t("planChipFree")}
          </span>
        </span>
        <span className="mt-[26px] block truncate font-display text-[27px] font-bold leading-8 tracking-[-0.03em] text-ink">
          {name}
        </span>
        <Suspense
          fallback={<CardStatsFallback labels={[t("statWatching"), t("statBadges"), t("statScans")]} />}
        >
          <CardStats userId={userId} />
        </Suspense>
      </FoilPanel>

      <Section title={t("sectionActivity")}>
        {activity.map((l) => (
          <MenuRow key={l.href} link={l} />
        ))}
        {communityV2 && (
          <Suspense fallback={<MenuRow link={messagesLink} />}>
            <MessagesRow link={messagesLink} userId={userId} />
          </Suspense>
        )}
      </Section>

      <Section title={t("sectionTools")}>
        {tools.map((l) => (
          <MenuRow key={l.href} link={l} />
        ))}
      </Section>

      {/* Pro står NEDANFÖR menyn med flit: sidan börjar med ditt konto, inte med
          ett erbjudande. Turkos används bara här. */}
      <Section title={t("sectionPro")}>
        <Link
          href="/priser"
          className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-[-0.005em] text-holo-cyan">
              {isPremium ? t("subscription") : t("upgrade")}
            </span>
            <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-faint">
              {isPremium ? t("manageBody") : t("proBody")}
            </span>
          </span>
          {!isPremium && (
            <span className="whitespace-nowrap text-[13px] text-ink-faint">{t("proPrice")}</span>
          )}
          <IconChevronRight size={18} className="shrink-0 text-holo-cyan" />
        </Link>
        <Suspense fallback={null}>
          <InviteRow userId={userId} label={t("inviteRow")} />
        </Suspense>
      </Section>

      <FollowTiles title={t("followTitle")} />

      <LogoutButton />
    </div>
  );
}
