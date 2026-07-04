"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";

export interface PricePoint {
  date: string; // YYYY-MM-DD
  price: number; // öre
}

const PERIODS = [
  { value: "1w", labelKey: "period1w", days: 7 },
  { value: "1m", labelKey: "period1m", days: 30 },
  { value: "3m", labelKey: "period3m", days: 90 },
  { value: "6m", labelKey: "period6m", days: 180 },
  { value: "1y", labelKey: "period1y", days: 365 },
  { value: "max", labelKey: "periodMax", days: Infinity },
] as const;

const DEFAULT = PERIODS.find((p) => p.value === "3m")!;

function withinDays(series: PricePoint[], days: number): PricePoint[] {
  if (!Number.isFinite(days)) return series;
  const cutoff = Date.now() - days * 86_400_000;
  return series.filter((p) => new Date(p.date).getTime() >= cutoff);
}

/**
 * Prishistorik-kortet. Hela serien (alla kända punkter) skickas in EN gång från
 * servern; perioden filtreras i klienten — ingen URL-param (sidan kan därför ISR-
 * cachas) och ingen extra hämtning per periodbyte.
 */
export function ProductPriceCard({
  title,
  subtitle,
  series,
}: {
  title: string;
  subtitle: string;
  series: PricePoint[];
}) {
  const t = useTranslations("Detail");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(DEFAULT);

  const filtered = withinDays(series, period.days);
  // Gles historik (t.ex. äldre sealed med en ensam arkivpunkt): har vald period
  // < 2 punkter men hela serien fler → visa hela istället för ett ensamt nuläge.
  const data = filtered.length < 2 && series.length >= 2 ? series : filtered;

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>
        </div>
        <div
          className="flex shrink-0 gap-0.5 self-start rounded-lg border border-surface-border bg-surface p-1"
          role="group"
          aria-label="Period"
        >
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p)}
              aria-current={p.value === period.value ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                p.value === period.value
                  ? "bg-holo-cyan/15 text-holo-cyan"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {/* data-swipe-ignore: horisontellt drag på grafen = tooltip-scrubbing,
            inte svep-tillbaka (overlayns gest hoppar över den här ytan). */}
        <div data-swipe-ignore>
          <PriceChartLazy data={data} />
        </div>
      </CardContent>
    </Card>
  );
}
