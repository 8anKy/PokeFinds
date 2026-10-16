"use client";

/**
 * Setets rubrikkort — samma i Utforska (`/produkter?set=<id>`) och på setsidan (ägaren
 * 2026-10-16: den gamla rubriken + sammansättningstabellen var för tung).
 *
 * Logga på en turkos "foliescen", namn + era + släppdatum, och tre tal: framsteg (ring),
 * setvärde (ett ex av varje kort) och ditt värde. Det personliga hämtas klient-sida via
 * `useOwnedSets` (sidorna är ISR/delade och får inte läsa sessionen).
 * Komplett set ⇒ ringen och kanten går över i foliegradient.
 */
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatKrWhole, useOwnedSets } from "@/lib/owned-sets";
import type { SetSummary } from "@/services/sets-gallery";

function ProgressRing({ pct, complete }: { pct: number; complete: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90" aria-hidden>
      <defs>
        <linearGradient id="set-hero-foil" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="50%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-surface-overlay" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        stroke={complete ? "url(#set-hero-foil)" : "#2dd4bf"}
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
        className="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  );
}

export function SetHero({
  set,
  actions,
  heading = "h2",
  className,
}: {
  set: SetSummary;
  /** Högerställd åtgärd (t.ex. "Bevaka förseglat"). */
  actions?: ReactNode;
  heading?: "h1" | "h2";
  className?: string;
}) {
  const t = useTranslations("SetHero");
  const locale = useLocale();
  const { loggedIn, owned } = useOwnedSets();
  const mine = owned?.[set.id];
  const count = mine?.owned ?? 0;
  const pct = set.total ? Math.min(100, Math.round((count / set.total) * 100)) : 0;
  const complete = set.total != null && count >= set.total && count > 0;
  const date = set.releaseDate
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "sv-SE", { dateStyle: "medium" }).format(new Date(set.releaseDate))
    : null;
  const H = heading;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border p-3 sm:p-4",
        complete ? "border-transparent [background:linear-gradient(#000,#000)_padding-box,linear-gradient(120deg,#2dd4bf,#a78bfa,#f472b6)_border-box]" : "border-surface-border",
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <div className="grid h-16 w-28 shrink-0 place-items-center rounded-xl bg-[radial-gradient(ellipse_at_center,rgba(45,212,191,0.16),transparent_70%)] p-2 sm:h-20 sm:w-36">
            {set.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={set.logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-center text-xs font-semibold text-ink-muted">{set.name}</span>
            )}
          </div>
          <div className="min-w-0">
            <H className="truncate font-display text-lg font-bold text-ink sm:text-xl">{set.name}</H>
            <p className="mt-0.5 truncate text-xs text-ink-muted sm:text-sm">
              {set.era !== "Other" ? set.era : t("otherEra")}
              {date && <> · {date}</>}
              {set.language === "JP" && <> · {t("japanese")}</>}
            </p>
            {complete && (
              <span className="mt-1 inline-block rounded-full bg-gradient-to-r from-holo-cyan via-holo-violet to-holo-pink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
                {t("complete")}
              </span>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-6">
          <div className="flex items-center gap-2">
            {set.total ? (
              <>
                <div className="relative hidden sm:block">
                  <ProgressRing pct={loggedIn ? pct : 0} complete={complete} />
                  <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold tabular-nums text-ink">
                    {loggedIn ? `${pct}%` : "–"}
                  </span>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{t("progress")}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-ink">
                    {loggedIn ? `${count} / ${set.total}` : t("cards", { count: set.total })}
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{t("progress")}</dt>
                <dd className="text-sm text-ink-muted">{t("noCards")}</dd>
              </div>
            )}
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{t("setValue")}</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">{formatKrWhole(set.setValueOre, locale)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{t("yourValue")}</dt>
            <dd className={cn("text-sm font-semibold tabular-nums", count > 0 ? "text-holo-cyan" : "text-ink-muted")}>
              {loggedIn ? (owned ? formatKrWhole(mine?.valueOre ?? 0, locale) : "…") : "–"}
            </dd>
          </div>
        </dl>

        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </section>
  );
}
