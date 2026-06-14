"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/produkter", label: "Utforska" },
  { href: "/marknad", label: "Marknad" },
  { href: "/community", label: "Community" },
  { href: "/priser", label: "Priser" },
];

export function HeaderNav() {
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
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
