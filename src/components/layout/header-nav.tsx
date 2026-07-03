"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/produkter", key: "explore" },
  { href: "/marknad", key: "market" },
  { href: "/community", key: "community" },
  { href: "/priser", key: "pricing" },
] as const;

export function HeaderNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {NAV_LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150",
              active
                ? "text-holo-cyan"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {t(l.key)}
          </Link>
        );
      })}
    </nav>
  );
}
