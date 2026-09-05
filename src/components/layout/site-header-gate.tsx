"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { isSubpageRoute } from "@/lib/subpage-routes";

/**
 * Döljer logotyphuvudet på MOBIL för undersidorna — där tar `SubpageHeader`
 * (bakåtcirkel + titel) över raden. Desktop visar alltid huvudet.
 *
 * Bara en klass, ingen `auth()`/`cookies()`: huvudet ligger i rot-nära layouter
 * som måste förbli statiskt renderbara (ISR-regeln i CLAUDE.md). `usePathname`
 * finns på servern också, så klassen är densamma vid SSR och hydrering.
 */
export function SiteHeaderGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className={isSubpageRoute(pathname) ? "hidden lg:block" : undefined}>{children}</div>;
}
