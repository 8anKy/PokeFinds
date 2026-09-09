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
  type IconProps,
} from "@/components/ui/icons";
import { SOCIAL_CHANNELS } from "@/components/features/join-us-card";
import { LogoutButton } from "./logout-button";
import { GuestMore } from "./guest-more";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { listUserAchievements } from "@/services/achievements";
import { getScannerQuota } from "@/services/scanner";
import { unreadConversationCount } from "@/services/chat";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("More");
  return { title: t("metaTitle") };
}

interface MenuLink {
  href: string;
  label: string;
  icon: (p: IconProps) => JSX.Element;
  /** Höger om etiketten: ett tal, aldrig en färgad etikett. */
  value?: string;
  /** Turkos prick i stället för ett tal (olästa meddelanden). */
  dot?: boolean;
}

/**
 * Sidans rytm: en sektion = en versal etikett + ett kort med hårlinjer emellan.
 *
 * ⛔ IKONERNA ÄR ENFÄRGADE (ink-faint) MED FLIT. Den gamla sidan gav varje rad
 * sin egen färg — cyan, grön, violett, guld, grått, violett, rött — utan att
 * färgen betydde något; sju färger som inte kodar något läser som dekor, och
 * det var det ägaren kallade barnsligt (2026-09-09). Turkos är kvar som EN
 * signal på sidan: Pro. Lägg inte tillbaka en färg per rad.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h2>
      <div className="overflow-hidden rounded-[14px] border border-surface-border">{children}</div>
    </section>
  );
}

function MenuRow({ link }: { link: MenuLink }) {
  return (
    <Link
      href={link.href}
      className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
    >
      <link.icon size={20} className="shrink-0 text-ink-faint" />
      <span className="flex-1 text-[15px] font-medium tracking-[-0.005em] text-ink">{link.label}</span>
      {link.value && <span className="text-sm tabular-nums text-ink-faint">{link.value}</span>}
      {link.dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-holo-cyan" />}
      <IconChevronRight size={18} className="shrink-0 text-ink-faint" />
    </Link>
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

  const activity: MenuLink[] = [
    { href: "/bevakningar", label: t("watches"), icon: IconBell, value: String(watchCount) },
    {
      href: "/mer/utmarkelser",
      label: tA("title"),
      icon: IconMedal,
      value: `${unlockedLevels} / ${totalUnlockable}`,
    },
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
      <Link
        href="/installningar"
        className="account-card block rounded-[18px] border border-surface-border p-[18px] transition-colors hover:border-ink/20"
      >
        <div className="relative flex items-start justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {t("cardRole")}
          </span>
          <span className="rounded-full border border-ink/20 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-ink">
            {isPremium ? t("planChipPro") : t("planChipFree")}
          </span>
        </div>
        <p className="relative mt-[26px] truncate font-display text-[27px] font-bold leading-8 tracking-[-0.03em] text-ink">
          {name}
        </p>
        <p className="relative mt-1 text-[13px] leading-[18px] text-ink-muted">
          {t("memberSince", { since: memberSince })}
        </p>
        <div className="relative mt-[22px] grid grid-cols-3 gap-3 border-t border-ink/10 pt-4">
          <span className="flex flex-col">
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {watchCount}
            </span>
            <span className="mt-[3px] text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {t("statWatching")}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {unlockedLevels}
              <span className="text-sm text-ink-muted">/{totalUnlockable}</span>
            </span>
            <span className="mt-[3px] text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {t("statBadges")}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {scansLeft}
            </span>
            <span className="mt-[3px] text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {t("statScans")}
            </span>
          </span>
        </div>
      </Link>

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
          <Link
            href="/mer/bjud-in"
            className="flex items-center gap-3.5 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
          >
            <span className="flex-1 text-[15px] text-ink-muted">{t("inviteRow")}</span>
            <IconChevronRight size={18} className="shrink-0 text-ink-faint" />
          </Link>
        )}
      </Section>

      {/* Tre kanaler = en rad brickor, inte tre menyrader. Externa länkar öppnar
          utanför appen, så de får inte se ut som appens egen navigering. */}
      <section>
        <h2 className="px-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          {t("followTitle")}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {SOCIAL_CHANNELS.map((c) => (
            <a
              key={c.label}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-surface-border text-ink-muted transition-colors hover:bg-surface-overlay/60 hover:text-ink active:bg-surface-overlay"
            >
              <c.icon size={20} className="shrink-0" />
              <span className="text-xs font-medium">{c.label}</span>
            </a>
          ))}
        </div>
      </section>

      <LogoutButton />
    </div>
  );
}
