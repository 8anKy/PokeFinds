import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BackCircle } from "@/components/ui/back-circle";

/**
 * Undersidans huvud — MOBIL: en fast rad under statusfältet med bakåtcirkeln,
 * titeln (17/600) och valfri underrad + EN högeråtgärd (en `CircleButton`).
 * DESKTOP: den vanliga stora rubriken (h1 + ingress) och ingen cirkel — där
 * finns sidomenyn.
 *
 * Raden ersätter logotyphuvudet på mobil: `SiteHeaderGate` döljer `SiteHeader`
 * för rutterna i `lib/subpage-routes.ts`, så en sida som använder det här
 * huvudet MÅSTE stå i den listan — annars ligger två huvuden ovanpå varandra.
 *
 * Måtten: raden är 48 px, drar sig ut till sidkanten med `-mx-2.5` (sidans
 * 10 px-luft) och upp med `-mt-6` (sidbehållarens `py-6`), så den börjar exakt
 * där huvudet slutade. Den är `sticky` under safe-arean; remsan ovanför
 * (statusfältets höjd) målas av `before:` så innehållet inte skiner igenom när
 * sidan scrollar. ⛔ Rutterna i `(app)`/`(mer)`/`(marketing)` har alla `py-6`
 * på mobil — ändras det måste `-mt-6` följa med.
 */
export function SubpageHeader({
  title,
  subtitle,
  fallback,
  href,
  action,
  desktopAction,
  desktopTitleClassName,
  mobileOnly = false,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Var bakåt landar utan historik. */
  fallback?: string;
  /** Bakåt som ren länk (t.ex. samtalet → listan). */
  href?: string;
  /** Sidans ENDA högeråtgärd på mobil — en `CircleButton`. */
  action?: ReactNode;
  /** Motsvarande åtgärd på desktop (ofta en vanlig knapp). Utelämnas → inget. */
  desktopAction?: ReactNode;
  desktopTitleClassName?: string;
  /** Sidan har redan en egen stor rubrik (forum, priser) → bara mobilraden. */
  mobileOnly?: boolean;
  className?: string;
}) {
  return (
    <header className={className}>
      {/* Mobil */}
      <div className="sticky top-[env(safe-area-inset-top)] z-30 -mx-2.5 -mt-6 mb-4 sm:-mx-6 lg:hidden before:absolute before:inset-x-0 before:bottom-full before:h-[env(safe-area-inset-top)] before:bg-surface before:content-['']">
        <div className="hairline-b flex h-12 items-center gap-3 bg-surface/90 px-2.5 backdrop-blur-md sm:px-6">
          <BackCircle fallback={fallback} href={href} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {title}
            </div>
            {subtitle && <div className="truncate text-xs text-ink-muted">{subtitle}</div>}
          </div>
          {action}
        </div>
      </div>
      {/* Desktop */}
      {!mobileOnly && (
      <div className="hidden lg:flex lg:items-start lg:justify-between lg:gap-4">
        <div>
          <h1 className={cn("font-display text-2xl font-bold text-ink", desktopTitleClassName)}>
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {desktopAction}
      </div>
      )}
    </header>
  );
}
