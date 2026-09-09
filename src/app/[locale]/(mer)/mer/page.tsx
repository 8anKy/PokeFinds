import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth, hasRole } from "@/lib/auth";
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

export default async function MerPage() {
  const session = await auth();
  const t = await getTranslations("More");
  // Gäst: ingen inloggningsvägg. Språk, om oss, villkor och Discord finns även
  // utan konto — inloggningen är en av raderna, inte hela sidan (QA 2026-09-05).
  if (!session?.user) return <GuestMore />;
  const isAdmin = hasRole(session.user.role, "MODERATOR");
  const isPremium = session.user.isPro;
  const userId = session.user.id;

  // Meddelanden (community v2) — grindat tills ägaren testat, se lib/community-v2-gate.ts.
  // Läser bara headers + roll, ingen DB, så den får stå före rundturen.
  const communityV2 = await communityV2Request(session.user.role);

  // ⛔ EN rundtur, inte sex. Två sekventiella await är två tur-och-retur mot
  // Frankfurt för en sida som redan är dynamisk; allt som kan gå parallellt gör
  // det, inklusive invite-räkningen som tidigare låg som en egen andra resa.
  const [watchCount, achievements, quota, account, hasEarnedInviteReward, unread, tA, tNav, locale] =
    await Promise.all([
      prisma.watchlistItem.count({ where: { userId } }),
      listUserAchievements(userId),
      getScannerQuota(userId, session.user.planTier, session.user.role),
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
      // Engångserbjudande: har användaren redan fått sin belöning (någon invite
      // rewardedAt) försvinner inbjudningsraden ur kontot (ägarbeslut).
      prisma.invite
        .count({ where: { inviterId: userId, rewardedAt: { not: null } } })
        .then((n) => n > 0),
      communityV2 ? unreadConversationCount(userId) : Promise.resolve(0),
      getTranslations("Achievements"),
      getTranslations("Nav"),
      getLocale(),
    ]);

  // ⛔ RÄKNA NIVÅER, INTE MÄRKEN. "Samlare" är tre nivåer (10/100/1000), så
  // nämnaren är 18 och inte 15 — annars kan täljaren passera nämnaren.
  const totalUnlockable = ACHIEVEMENTS.reduce((n, d) => n + d.tiers.length, 0);
  const unlockedLevels = achievements.length;

  const name = session.user.name ?? t("defaultName");
  const memberSince = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(account?.createdAt ?? new Date());

  // ⛔ PRO SER "∞", INTE ETT TAL. Pro-taket (1000/mån) är ett SKYDD mot skenande
  // kostnad, inte en produktgräns: villkoren säger "skäligt bruk" och skannerns
  // egen Pro-badge visar ∞. Skriver den här sidan ut "996 kvar" har vi plötsligt
  // publicerat en gräns kunden aldrig fått se. Se services/scanner/index.ts.
  const scansLeft = isPremium || isAdmin ? "∞" : String(quota.remaining);

  // ⛔ BEVAKNINGAR OCH MÄRKEN BÄR INGET TAL HÄR (ägarbeslut 2026-09-09): talen
  // står redan på kontokortet ovan, och samma siffra två gånger på en skärm gör
  // ingen av dem trovärdig. Kortet visar TILLSTÅNDET, listan är VÄGEN dit.
  const activity: MenuLink[] = [
    { href: "/bevakningar", label: t("watches"), icon: IconBell },
    { href: "/mer/utmarkelser", label: tA("title"), icon: IconMedal },
    ...(communityV2
      ? [{ href: "/meddelanden", label: tNav("messages"), icon: IconMail, dot: unread > 0 }]
      : []),
  ];

  const tools: MenuLink[] = [
    { href: "/gradera", label: t("grading"), icon: IconShield },
    { href: "/installningar", label: t("settings"), icon: IconSliders },
    ...(isAdmin ? [{ href: "/admin", label: t("admin"), icon: IconPanel }] : []),
  ];

  return (
    <div className="mx-auto max-w-md space-y-[26px]">
      {/* Kontokortet ÄR sidans rubrik — "Mer / Hantera ditt konto och dina
          inställningar" sa inget som raderna under inte redan säger, och en
          rubrik som heter samma sak som fliken man just tryckte på är brus. */}
      <FoilPanel href="/installningar">
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
        <span className="mt-1 block text-[13px] leading-[18px] text-ink-muted">
          {t("memberSince", { since: memberSince })}
        </span>
        <span className="mt-[22px] grid grid-cols-3 gap-3 border-t border-ink/10 pt-4">
          <Stat value={String(watchCount)} label={t("statWatching")} />
          <Stat value={String(unlockedLevels)} sub={`/${totalUnlockable}`} label={t("statBadges")} />
          <Stat value={scansLeft} label={t("statScans")} />
        </span>
      </FoilPanel>

      <Section title={t("sectionActivity")}>
        {activity.map((l) => (
          <MenuRow key={l.href} link={l} />
        ))}
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
        {!hasEarnedInviteReward && (
          <MenuRow link={{ href: "/mer/bjud-in", label: t("inviteRow") }} />
        )}
      </Section>

      <FollowTiles title={t("followTitle")} />

      <LogoutButton />
    </div>
  );
}
