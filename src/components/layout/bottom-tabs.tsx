"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  IconSearch,
  IconPackage,
  IconCamera,
  IconMessage,
  IconMenu,
  type IconProps,
} from "@/components/ui/icons";

const TABS: { href: string; label: string; icon: (p: IconProps) => JSX.Element }[] = [
  { href: "/produkter", label: "Utforska", icon: IconSearch },
  { href: "/samling", label: "Portfölj", icon: IconPackage },
  { href: "/skanna", label: "Skanna", icon: IconCamera },
  { href: "/community", label: "Community", icon: IconMessage },
  { href: "/mer", label: "Mer", icon: IconMenu },
];

export function BottomTabs() {
  const pathname = usePathname();
  // Sessionen läses klient-sida → inget server-`auth()` som tvingar hela appen
  // dynamisk (det brände Vercel Active CPU). Dölj tab-baren för utloggade.
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <>
      {/* Klarering: fixed nav överlappar sidans botten — denna spacer ger
          scroll-utrymme så sista innehållet inte göms (ersätter layoutens pb-20). */}
      <div aria-hidden className="h-16 lg:hidden" />
      <nav
        aria-label="Huvudnavigering"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
      <ul className="mx-auto flex max-w-md items-stretch">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname?.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors duration-150",
                  active ? "text-holo-cyan" : "text-ink-muted hover:text-ink"
                )}
              >
                <t.icon size={22} className="shrink-0" />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
      </nav>
    </>
  );
}
