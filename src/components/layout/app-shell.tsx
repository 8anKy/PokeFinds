"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import {
  IconDashboard,
  IconSearch,
  IconBell,
  IconPackage,
  IconCamera,
  IconShield,
  IconChart,
  IconMessage,
  IconSettings,
  IconWrench,
  IconUser,
  type IconProps,
} from "@/components/ui/icons";
import { BrandLogo } from "@/components/layout/brand-logo";

const NAV: { href: string; label: string; icon: (p: IconProps) => JSX.Element }[] = [
  { href: "/dashboard", label: "Översikt", icon: IconDashboard },
  { href: "/produkter", label: "Utforska", icon: IconSearch },
  { href: "/bevakningar", label: "Bevakningar", icon: IconBell },
  { href: "/samling", label: "Min samling", icon: IconPackage },
  { href: "/skanna", label: "Skanna kort", icon: IconCamera },
  { href: "/gradera", label: "Gradera kort", icon: IconShield },
  { href: "/marknad", label: "Marknad", icon: IconChart },
  { href: "/community", label: "Community", icon: IconMessage },
  { href: "/installningar", label: "Inställningar", icon: IconSettings },
];

export function AppShell({
  children,
  userName,
  isAdmin,
}: {
  children: React.ReactNode;
  userName: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
            pathname?.startsWith(item.href)
              ? "bg-holo-cyan/10 text-holo-cyan"
              : "text-ink-muted hover:bg-surface-overlay/60 hover:text-ink hover:translate-x-0.5"
          )}
        >
          <item.icon size={18} className="shrink-0" />
          {item.label}
        </Link>
      ))}
      {isAdmin && (
        <Link
          href="/admin"          className={cn(
            "mt-2 flex items-center gap-3 rounded-lg border border-holo-violet/30 px-3 py-2 text-sm",
            pathname?.startsWith("/admin")
              ? "bg-surface-overlay text-holo-violet"
              : "text-holo-violet/80 hover:bg-surface-overlay/50"
          )}
        >
          <IconWrench size={18} className="shrink-0" />
          Adminpanel
        </Link>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-surface-border bg-surface-raised/40 lg:block">
        <div className="flex h-16 items-center border-b border-surface-border px-5">
          <BrandLogo markSize={26} textClass="text-lg" />
        </div>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="z-40 flex h-16 items-center justify-between border-b border-surface-border bg-surface/85 px-4 backdrop-blur-md lg:sticky lg:top-0">
          <div className="flex items-center gap-3">
            <span className="lg:hidden">
              <BrandLogo />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">Hej, {userName}</span>
            <button
              onClick={() => {
                setAuthHint(false);
                void signOut({ callbackUrl: "/" });
              }}
              className="hidden rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink sm:inline-block"
            >
              Logga ut
            </button>
            <Link
              href="/installningar"
              aria-label="Profil"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-holo-cyan"
            >
              <IconUser size={18} />
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
