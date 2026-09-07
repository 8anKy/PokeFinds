"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useCommunityV2 } from "@/lib/use-community-v2";

// Fyra huvudflikar på desktop (ägarbeslut 2026-08-11), samma Portfölj-mål som
// mobilens tabb = /samling. ⛔ Marknad är BORTTAGEN (ägarbeslut 2026-09-07): fliken
// var admin-only sedan 2026-07-21 och sidan tillförde inget vi inte visar bättre på
// /produkter — hela rutten är raderad, inte bara länken.
const NAV_LINKS = [
  { href: "/produkter", key: "explore" },
  { href: "/samling", key: "portfolio" },
  { href: "/community", key: "community" },
  { href: "/priser", key: "pricing" },
] as const;

export function HeaderNav() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  // Community → Forum för den som community-grinden släpper in (lib/community-v2-gate.ts).
  const communityV2 = useCommunityV2();
  const links = NAV_LINKS.map((l) =>
    communityV2 && l.key === "community" ? { href: "/forum", key: "forum" } : l
  );
  return (
    <nav className="hidden items-center gap-1 md-tall:flex">
      {links.map((l) => {
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
