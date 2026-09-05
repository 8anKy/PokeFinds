import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { communityV2Request } from "@/lib/community-v2-server";
import {
  IconShield,
  IconBell,
  IconMail,
  IconSparkle,
  IconSettings,
  IconWrench,
  IconTrophy,
  IconGift,
  IconChevronRight,
  IconExternalLink,
  type IconProps,
} from "@/components/ui/icons";
import { SOCIAL_CHANNELS } from "@/components/features/join-us-card";
import { LogoutButton } from "./logout-button";
import { GuestMore } from "./guest-more";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { listUserAchievements } from "@/services/achievements";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("More");
  return { title: t("metaTitle") };
}

interface MenuLink {
  href: string;
  label: string;
  icon: (p: IconProps) => JSX.Element;
  iconClass: string;
  badge?: string;
}

export default async function MerPage() {
  const session = await auth();
  const t = await getTranslations("More");
  // Gäst: ingen inloggningsvägg. Språk, om oss, villkor och Discord finns även
  // utan konto — inloggningen är en av raderna, inte hela sidan (QA 2026-09-05).
  if (!session?.user) return <GuestMore />;
  const isAdmin = hasRole(session.user.role, "MODERATOR");
  const isPremium = session.user.isPro;

  // ⛔ EN rundtur, inte två. Två sekventiella await är två tur-och-retur mot
  // Frankfurt för en sida som redan är dynamisk.
  const [watchCount, achievements, tA, tNav, communityV2] = await Promise.all([
    prisma.watchlistItem.count({ where: { userId: session.user.id } }),
    listUserAchievements(session.user.id),
    getTranslations("Achievements"),
    getTranslations("Nav"),
    // Meddelanden (community v2) — grindat tills ägaren testat, se lib/community-v2-gate.ts.
    communityV2Request(session.user.role),
  ]);
  // ⛔ RÄKNA NIVÅER, INTE MÄRKEN. "Samlare" är tre nivåer (10/100/1000), så
  // nämnaren är 18 och inte 15 — annars kan täljaren passera nämnaren.
  const totalUnlockable = ACHIEVEMENTS.reduce((n, d) => n + d.tiers.length, 0);
  const unlockedLevels = achievements.length;

  const name = session.user.name ?? t("defaultName");
  const initial = name.trim().charAt(0).toUpperCase() || "S";

  const links: MenuLink[] = [
    {
      // ⛔ EN EGEN SIDA, inte en chip-rad här. En rad upplåsta märken visar
      // varken vad som finns kvar eller hur man når dit — och det är det man
      // öppnar en utmärkelselista för. Antalet i badgen är NIVÅER, inte märken.
      href: "/mer/utmarkelser",
      label: tA("title"),
      icon: IconSparkle,
      iconClass: "text-holo-cyan",
      badge: tA("progress", { count: unlockedLevels, total: totalUnlockable }),
    },
    {
      href: "/bevakningar",
      label: t("watches"),
      icon: IconBell,
      iconClass: "text-rise",
      badge: watchCount > 0 ? t("watchesBadge", { count: watchCount }) : undefined,
    },
    ...(communityV2
      ? [{ href: "/meddelanden", label: tNav("messages"), icon: IconMail, iconClass: "text-holo-cyan" }]
      : []),
    { href: "/gradera", label: t("grading"), icon: IconShield, iconClass: "text-holo-violet" },
    {
      href: "/priser",
      label: isPremium ? t("subscription") : t("upgrade"),
      icon: IconTrophy,
      iconClass: "text-holo-gold",
    },
    { href: "/installningar", label: t("settings"), icon: IconSettings, iconClass: "text-ink-muted" },
  ];

  // Engångserbjudande: har användaren redan fått sin belöning (någon invite
  // rewardedAt) försvinner hela invite-sektionen ur kontot (ägarbeslut).
  const hasEarnedInviteReward =
    (await prisma.invite.count({
      where: { inviterId: session.user.id, rewardedAt: { not: null } },
    })) > 0;

  return (
    <div className="mx-auto max-w-md space-y-4">
      {/* Rubrik */}
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("subtitle")}</p>
      </header>

      {/* Bjud in vänner (#10) — 3 verifierade = 1 månad Pro. Döljs för alltid
          när belöningen är uttagen (engångs). */}
      {!hasEarnedInviteReward && (
        <Link
          href="/mer/bjud-in"
          className="flex items-center gap-3 rounded-2xl border border-holo-cyan/30 bg-holo-cyan/10 px-4 py-3 transition-colors hover:bg-holo-cyan/15 active:bg-holo-cyan/20"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-holo-cyan/15 text-holo-cyan ring-1 ring-holo-cyan/30">
            <IconGift size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{t("inviteTitle")}</span>
            <span className="block text-xs text-ink-muted">{t("inviteSubtitle")}</span>
          </span>
          <IconChevronRight size={18} className="shrink-0 text-holo-cyan" />
        </Link>
      )}

      {/* Konto + meny i ett grupperat kort */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        {/* Profilrad */}
        <Link
          href="/installningar"
          className="flex items-center gap-3 border-b border-surface-border bg-surface-overlay/40 px-4 py-3 transition-colors hover:bg-surface-overlay active:bg-surface-overlay"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-holo-cyan/15 text-lg font-bold text-holo-cyan ring-1 ring-holo-cyan/30">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-ink">{name}</span>
            <span className="block text-xs text-ink-muted">
              {isPremium ? t("proMember") : t("freeMember")}
            </span>
          </span>
          <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
        </Link>

        {/* Menyrader */}
        <nav className="flex flex-col">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
            >
              <l.icon size={20} className={`shrink-0 ${l.iconClass}`} />
              <span className="flex-1 text-sm font-medium text-ink">{l.label}</span>
              {l.badge && (
                <span className="rounded-full border border-surface-border bg-surface-overlay px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted">
                  {l.badge}
                </span>
              )}
              <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
            </Link>
          ))}
          {/* "Support & FAQ" och "Rapportera bugg" borttagna 2026-07-21 (ägarbeslut).
              /kontakt-sidan finns kvar och nås via sidfoten. */}
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 border-t border-surface-border px-4 py-3 transition-colors hover:bg-surface-overlay/60 active:bg-surface-overlay"
            >
              <IconWrench size={20} className="shrink-0 text-holo-violet" />
              <span className="flex-1 text-sm font-medium text-ink">{t("admin")}</span>
              <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
            </Link>
          )}
          {/* Logga ut som sista menyrad (inte fristående knapp) → sidan ryms
              utan scroll på mobil även med invite-kort + adminrad. */}
          <LogoutButton />
        </nav>
      </div>

      {/* Följ Foilio — samma kanallista som katalogens "Häng med oss"-kort.
          Externa länkar (öppnar utanför appen) → utåtpil, inte chevron. */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        <p className="border-b border-surface-border px-4 py-3 text-sm font-semibold text-ink">
          {t("followTitle")}
        </p>
        <nav className="flex flex-col">
          {SOCIAL_CHANNELS.map((c) => (
            <a
              key={c.label}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-overlay/60 active:bg-surface-overlay"
            >
              <c.icon size={20} className="shrink-0 text-ink-muted" />
              <span className="flex-1 text-sm font-medium text-ink">{c.label}</span>
              <IconExternalLink size={16} className="shrink-0 text-ink-muted" />
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
