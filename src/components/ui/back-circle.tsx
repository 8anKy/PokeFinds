"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { IconChevronLeft } from "@/components/ui/icons";

/**
 * APPENS ENDA BAKÅTKNAPP (ägarbeslut 2026-09-05): en 40 px cirkel — mörk platta
 * (`surface-overlay` vid 85 % + oskärpa), hårlinje, chevron 20 px. Samma form
 * överallt: flytande över produktbilden, i undersidornas huvud (`SubpageHeader`),
 * i meddelandesamtalet. Den ersatte fyra olika: raden "‹ Tillbaka"
 * (`PageBackButton`), forumets textlänk "‹ Forum", chattens kantlösa 36 px-chevron
 * och produktsidans egen knapp.
 *
 * `CircleButton` är samma platta för sidans EN högeråtgärd (+ på Bevakningar,
 * ⋯ i samtalet) — aldrig fler än en, annars blir raden en verktygsrad.
 *
 * Bakåt = historiken när den finns (svep-tillbaka och Android-bakåt går samma
 * väg), annars `fallback` — landar man via djuplänk/push finns inget att backa
 * till. `href` byter ut hela beteendet mot en vanlig länk (samtalet går alltid
 * till listan, oavsett hur man kom dit).
 */
export const CIRCLE_CLASS =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface-overlay/85 text-ink backdrop-blur-md transition-[transform,background-color] duration-150 hover:bg-surface-overlay active:scale-[0.97] active:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan/60";

export function CircleButton({
  label,
  href,
  onClick,
  className,
  children,
}: {
  /** Skärmläsaretikett — knappen bär bara en ikon. */
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cn(CIRCLE_CLASS, className)}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(CIRCLE_CLASS, className)}>
      {children}
    </button>
  );
}

export function BackCircle({
  fallback = "/produkter",
  href,
  className,
}: {
  /** Dit vi går när det inte finns någon historik (djuplänk, push-notis). */
  fallback?: string;
  /** Alltid en länk hit — hoppar över historiken helt. */
  href?: string;
  className?: string;
}) {
  const t = useTranslations("PageNav");
  const router = useRouter();
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(fallback);
  };
  return (
    <CircleButton label={t("back")} href={href} onClick={href ? undefined : onBack} className={className}>
      <IconChevronLeft size={20} />
    </CircleButton>
  );
}
