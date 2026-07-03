import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  IconShield,
  IconBell,
  IconSettings,
  IconWrench,
  IconTrophy,
  IconInfo,
  IconFlag,
  IconChevronRight,
  type IconProps,
} from "@/components/ui/icons";
import { LogoutButton } from "./logout-button";
import { LockScroll } from "@/components/lock-scroll";

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
  if (!session?.user) redirect("/logga-in");
  const t = await getTranslations("More");
  const isAdmin = hasRole(session.user.role, "MODERATOR");
  const isPremium = session.user.planTier === "PREMIUM";

  const watchCount = await prisma.watchlistItem.count({
    where: { userId: session.user.id },
  });

  const name = session.user.name ?? t("defaultName");
  const initial = name.trim().charAt(0).toUpperCase() || "S";

  const links: MenuLink[] = [
    {
      href: "/bevakningar",
      label: t("watches"),
      icon: IconBell,
      iconClass: "text-rise",
      badge: watchCount > 0 ? t("watchesBadge", { count: watchCount }) : undefined,
    },
    { href: "/gradera", label: t("grading"), icon: IconShield, iconClass: "text-holo-violet" },
    {
      href: "/priser",
      label: isPremium ? t("subscription") : t("upgrade"),
      icon: IconTrophy,
      iconClass: "text-holo-gold",
    },
    { href: "/installningar", label: t("settings"), icon: IconSettings, iconClass: "text-ink-muted" },
    { href: "/kontakt", label: t("support"), icon: IconInfo, iconClass: "text-ink-muted" },
  ];

  return (
    <div className="mx-auto max-w-md space-y-6">
      <LockScroll />
      {/* Rubrik */}
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("subtitle")}</p>
      </header>

      {/* Konto + meny i ett grupperat kort */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised/40">
        {/* Profilrad */}
        <Link
          href="/installningar"
          className="flex items-center gap-3 border-b border-surface-border bg-surface-overlay/40 px-4 py-4 transition-colors hover:bg-surface-overlay"
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
              className="flex items-center gap-3 border-b border-surface-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-overlay/60"
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
          {/* Rapportera bugg — mailto öppnar mejlappen (funkar även i Capacitor),
              ingen backend behövs. ponytail: byt till formulär om volymen kräver det. */}
          <a
            href={
              "mailto:hej@foilio.se?subject=" +
              encodeURIComponent(t("bugSubject")) +
              "&body=" +
              encodeURIComponent(t("bugBody"))
            }
            className="flex items-center gap-3 border-b border-surface-border px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface-overlay/60"
          >
            <IconFlag size={20} className="shrink-0 text-rise" />
            <span className="flex-1 text-sm font-medium text-ink">{t("reportBug")}</span>
            <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
          </a>
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 border-t border-surface-border px-4 py-3.5 transition-colors hover:bg-surface-overlay/60"
            >
              <IconWrench size={20} className="shrink-0 text-holo-violet" />
              <span className="flex-1 text-sm font-medium text-ink">{t("admin")}</span>
              <IconChevronRight size={18} className="shrink-0 text-ink-muted" />
            </Link>
          )}
        </nav>
      </div>

      <LogoutButton />
    </div>
  );
}
