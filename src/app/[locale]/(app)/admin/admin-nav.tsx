"use client";

import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "Översikt" },
  { href: "/admin/anvandare", label: "Användare" },
  { href: "/admin/kallor", label: "Datakällor" },
  { href: "/admin/jobb", label: "Scrapingjobb" },
  { href: "/admin/rapporter", label: "Rapporter" },
  { href: "/admin/butiker", label: "Butiker" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Adminnavigering"
      className="flex gap-1 overflow-x-auto rounded-lg border border-surface-border bg-surface-raised p-1"
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
              isActive
                ? "bg-surface-overlay text-holo-cyan shadow-card"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
