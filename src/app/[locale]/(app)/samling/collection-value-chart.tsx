"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { IconLock, IconTrendingDown, IconTrendingUp } from "@/components/ui/icons";
import { formatPrice, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Point = { date: string; price: number };

const RANGES = [
  { key: "1v", label: "1v", days: 7, period: "senaste veckan" },
  { key: "1m", label: "1m", days: 30, period: "senaste 30 dagarna" },
  { key: "3m", label: "3m", days: 90, period: "senaste 3 månaderna" },
  { key: "6m", label: "6m", days: 183, period: "senaste 6 månaderna" },
  { key: "max", label: "Max", days: null, period: "sedan start" },
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
  itemCount,
}: {
  data: Point[];
  isPremium: boolean;
  /** Kant-till-kant utan kort: hero + graf först, periodväljaren centrerad under. */
  bleed?: boolean;
  /** Mobil-hero (bleed): aktuellt totalvärde i öre. */
  totalValue?: number;
  /** Mobil-hero (bleed): antal objekt. */
  itemCount?: number;
}) {
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
        aria-label={showPct ? "Visa förändring i kronor" : "Visa förändring i procent"}
        className={cn(
          "font-semibold tabular-nums underline-offset-4 transition-opacity hover:opacity-80 hover:underline",
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
                title="Lås upp full historik med Premium"
              >
                <IconLock size={12} /> Max
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
              {opt.label}
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
          Totalt värde
        </p>
        <div className="mt-1.5">
          <span className="font-display text-5xl font-bold tracking-tight tabular-nums text-ink">
            {formatPrice(totalValue ?? 0)}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {heroChange} {r.period}
          {itemCount != null && <> · {itemCount} objekt</>}
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
          <span className="hidden text-xs text-ink-muted sm:inline">{r.period}</span>
        </div>
      </div>
      <PriceChartLazy data={filtered} minimal />
    </div>
  );
}
