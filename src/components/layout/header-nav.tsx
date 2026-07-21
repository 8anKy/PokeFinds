"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/components/admin-only";

// Marknad är ADMIN-ONLY (ägarbeslut 2026-07-21): vanliga besökare ska bara se
// Utforska, Community och Priser. Sidan finns kvar och nås via URL — det här är
// bara navigationen.
const NAV_LINKS = [
  { href: "/produkter", key: "explore" },
  { href: "/marknad", key: "market", adminOnly: true },
  { href: "/community", key: "community" },
  { href: "/priser", key: "pricing" },
] as const;

export function HeaderNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const isAdmin = useIsAdmin();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {NAV_LINKS.filter((l) => !("adminOnly" in l && l.adminOnly) || isAdmin).map((l) => {
        const active = pathname === l.href || pathname?.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
              active ? "text-ink" : "text-ink-muted hover:text-ink"
            )}
          >
            {t(l.key)}
            {/* Aktiv-markör: cyan linje som växer ut från mitten (transform → GPU). */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-3 -bottom-0.5 h-0.5 origin-center rounded-full bg-holo-cyan transition-transform duration-300 ease-out-soft",
                active ? "scale-x-100" : "scale-x-0"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
