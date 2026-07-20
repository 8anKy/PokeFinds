"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { IconLock, IconTrendingDown, IconTrendingUp } from "@/components/ui/icons";
import { formatPrice, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Point = { date: string; price: number };

const RANGES = [
  { key: "1v", labelKey: "range1w", days: 7, periodKey: "periodWeek" },
  { key: "1m", labelKey: "range1m", days: 30, periodKey: "periodMonth" },
  { key: "3m", labelKey: "range3m", days: 90, periodKey: "period3m" },
  { key: "6m", labelKey: "range6m", days: 183, periodKey: "period6m" },
  { key: "max", labelKey: "rangeMax", days: null, periodKey: "periodStart" },
] as const;

/** Beräknar datumsträng (YYYY-MM-DD) N dagar före `lastDate`. */
function cutoff(lastDate: string, days: number): string {
  const d = new Date(`${lastDate}T00:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CollectionValueChart({
  data,
  isPremium,
  bleed = false,
  totalValue,
}: {
  data: Point[];
  isPremium: boolean;
  /** Kant-till-kant utan kort: hero + graf först, periodväljaren centrerad under. */
  bleed?: boolean;
  /** Mobil-hero (bleed): aktuellt totalvärde i öre. */
  totalValue?: number;
}) {
  const t = useTranslations("Collection");
  const [range, setRange] = useState<string>("max");
  // Hero-förändring: visa kr som standard, tryck för att växla till procent.
  const [showPct, setShowPct] = useState(false);

  const r = RANGES.find((x) => x.key === range) ?? RANGES[RANGES.length - 1];
  const filtered =
    r.days == null || data.length === 0
      ? data
      : data.filter((p) => p.date >= cutoff(data[data.length - 1].date, r.days));

  // Förändring över VALD period = sista punkten − första punkten i intervallet.
  const first = filtered[0]?.price;
  const last = filtered[filtered.length - 1]?.price;
  const delta = first != null && last != null ? last - first : null;
  const pct = first != null && first > 0 && delta != null ? (delta / first) * 100 : null;
  const up = (delta ?? 0) >= 0;

  // Hero-förändring som ETT värde i taget: kr eller % (tryck växlar).
  const flat = delta == null || delta === 0;
  const changeColor = flat ? "text-ink-muted" : up ? "text-rise" : "text-fall";
  const krText = delta == null ? "–" : `${up ? "+" : "−"}${formatPrice(Math.abs(delta))}`;
  const pctText = pct != null ? formatPercent(Math.round(pct * 100) / 100) : null;
  const heroChange =
    pctText != null ? (
      <button
        type="button"
        onClick={() => setShowPct((v) => !v)}
        aria-label={showPct ? t("showInKr") : t("showInPct")}
        className={cn(
          // Ingen underline/focus-ring: på touch fastnar hover/focus efter tryck och
          // ritade en linje/ram runt värdet (ägaren 2026-07-17). Växlingen ÄR feedbacken.
          "font-semibold tabular-nums transition-opacity hover:opacity-80 focus:outline-none",
          changeColor
        )}
      >
        {showPct ? pctText : krText}
      </button>
    ) : (
      <span className={cn("font-semibold tabular-nums", changeColor)}>{krText}</span>
    );

  const changePill = pct != null && (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        flat ? "bg-surface-raised text-ink-muted" : up ? "bg-rise/15 text-rise" : "bg-fall/15 text-fall"
      )}
    >
      {!flat && (up ? <IconTrendingUp size={14} /> : <IconTrendingDown size={14} />)}
      {formatPercent(Math.round(pct * 100) / 100)}
    </span>
  );

  const selector = (
    <div className={cn(bleed ? "mt-4 flex justify-center px-4" : "")}>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-surface-border bg-surface-raised p-1">
        {RANGES.map((opt) => {
          // Max är en premium-funktion: gratis-användare ser bara upp till 6 mån.
          if (opt.key === "max" && !isPremium) {
            return (
              <Link
                key={opt.key}
                href="/priser"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-faint transition-colors hover:text-holo-cyan"
                title={t("unlockMax")}
              >
                <IconLock size={12} /> {t("rangeMax")}
              </Link>
            );
          }
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              aria-pressed={range === opt.key}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                range === opt.key
                  ? "bg-holo-cyan/15 text-holo-cyan"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Mobil: full hero (label + värde + periodförändring + graf + väljare).
  if (bleed) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("totalValueLabel")}
        </p>
        <div className="mt-1.5">
          <AnimatedNumber
            value={totalValue ?? 0}
            className="font-display text-5xl font-bold tracking-tight text-ink"
          />
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {heroChange} {t(r.periodKey)}
        </p>
        <div className="-mx-4 mt-5 sm:-mx-6">
          <PriceChartLazy data={filtered} minimal />
        </div>
        {selector}
      </div>
    );
  }

  // Desktop: väljare + periodförändring på en rad, sedan grafen.
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        {selector}
        <div className="flex items-center gap-2">
          {changePill}
          <span className="hidden text-xs text-ink-muted sm:inline">{t(r.periodKey)}</span>
        </div>
      </div>
      <PriceChartLazy data={filtered} minimal />
    </div>
  );
}
