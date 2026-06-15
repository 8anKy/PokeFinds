"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";
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
  IconMenu,
  IconX,
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
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={cn(
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
          href="/admin"
          onClick={() => setMobileOpen(false)}
          className={cn(
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
          <Link href="/" aria-label="Foilio — startsida">
            <BrandLogo markSize={26} textClass="text-lg" />
          </Link>
        </div>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-surface-border bg-surface/90 px-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-ink-muted hover:bg-surface-overlay lg:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "Stäng meny" : "Öppna meny"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <IconX size={20} /> : <IconMenu size={20} />}
            </button>
            <Link href="/" className="lg:hidden" aria-label="Foilio — startsida">
              <BrandLogo markSize={26} textClass="text-lg" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">Hej, {userName}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
            >
              Logga ut
            </button>
          </div>
        </header>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="animate-fade-in border-b border-surface-border bg-surface-raised lg:hidden">{nav}</div>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
