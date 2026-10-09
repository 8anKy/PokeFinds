"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useMarkSeenOnRoute, useUnseen } from "@/lib/use-unseen";
import type { UnseenSection } from "@/lib/unseen";

/**
 * Liten turkos prick på Community/Nyheter när något nytt finns sedan sektionen
 * senast öppnades (lib/unseen.ts). Ingen siffra. Placeras av föräldern: den här
 * komponenten är `absolute` och föräldern måste vara `relative`.
 */
export function UnseenDot({ section, className }: { section: UnseenSection; className?: string }) {
  const t = useTranslations("Nav");
  const show = useUnseen(section);
  if (!show) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute h-2 w-2 rounded-full bg-holo-cyan ring-2 ring-surface motion-safe:animate-tab-pop",
        className
      )}
    >
      <span className="sr-only">{t("unseen")}</span>
    </span>
  );
}

/** Monteras en gång i rot-layouten: att öppna en sektion släcker dess prick. */
export function UnseenRouteMarker() {
  useMarkSeenOnRoute();
  return null;
}
