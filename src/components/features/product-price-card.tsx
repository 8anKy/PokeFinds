"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSession } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { hasAuthHint } from "@/lib/auth-hint";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconLock } from "@/components/ui/icons";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import type { PriceChartSeries } from "@/components/features/price-chart";

export interface PricePoint {
  date: string; // YYYY-MM-DD
  price: number; // öre
}

/**
 * KÄLLFÄRGERNA — validerade, inte valda på känsla.
 *
 * Kört genom dataviz-validatorn mot den svarta ytan: alla par klarar CVD-kravet
 * (värsta paret ΔE 8,4 deutan / 9,8 tritan, mål ≥8) och kontrasten mot bakgrunden
 * är >3:1 för alla fyra. Den enda check som inte går igenom är ljushetsbandet, och
 * det beror på varumärkesfärgen själv (#2dd4bf ligger på L 0,785 mot bandets tak
 * 0,67) — den är appens signatur och byts inte för en graf. Identiteten bärs
 * därför ALDRIG av färg ensam: varje källa har en text-etikett i knappraden som
 * fungerar som diagrammets legend.
 *
 * ⛔ Färgen följer KÄLLAN, aldrig ordningen. Bockar man ur Cardmarket ska Tradera
 * inte plötsligt bli turkos.
 */
export const SOURCE_COLORS: Record<string, string> = {
  cardmarket: "#2dd4bf", // varumärkets turkos
  cardtrader: "#a78bfa",
  tradera: "#f5a524",
};

/**
 * Ordningen källorna visas i — mest täckande först.
 * ⛔ Butiker ingår INTE: de är länkar, inte en marknad. Se HISTORY_SOURCE_KEYS.
 */
const SOURCE_ORDER = ["cardmarket", "cardtrader", "tradera"] as const;
export type SourceKey = (typeof SOURCE_ORDER)[number];

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
  bySource,
}: {
  title: string;
  subtitle: string;
  series: PricePoint[];
  /** Alla källors serier. Saknas den beter sig kortet exakt som förut. */
  bySource?: Partial<Record<SourceKey, PricePoint[]>>;
}) {
  const t = useTranslations("Detail");
  const router = useRouter();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(DEFAULT);
  // Full historik (MAX) är en Pro-förmån. Sidan ISR-cachas → plan läses klient-sida.
  // null/false = ej Pro → MAX låst (klick → prissida). Utloggad räknas som ej Pro.
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!hasAuthHint()) return;
    void getSession().then((s) => setIsPro(!!s?.user?.isPro));
  }, []);

  // Bara källor som FAKTISKT har punkter får en knapp — en avbockningsbar källa
  // utan data är en död kontroll, och på 5 095 produkter finns bara en källa alls.
  const available = SOURCE_ORDER.filter((k) => (bySource?.[k]?.length ?? 0) > 0);
  /**
   * START: EN källa, inte alla.
   *
   * Cardmarket är förvalet — det är den källa rubriken och det publicerade priset
   * bygger på ("golvet rakt av"), så grafen öppnar på samma tal som står ovanför
   * den. Alla serier påslagna från början gav dessutom ett överlagrat diagram
   * innan besökaren bett om en jämförelse; att lägga TILL en kurva är ett aktivt
   * val, att behöva plocka BORT tre är städning.
   *
   * ⛔ FALLER TILLBAKA PÅ FÖRSTA TILLGÄNGLIGA. Tryckningsvarianterna (reverse
   * holo, boll, 1st Edition) har INGEN Cardmarket-serie alls — CardTrader är hela
   * deras historik. Ett hårdkodat "cardmarket" hade öppnat dem på en tom ruta.
   */
  const [off, setOff] = useState<Set<string>>(() => {
    const primary = available.includes("cardmarket") ? "cardmarket" : available[0];
    return new Set(available.filter((k) => k !== primary));
  });
  const selected = available.filter((k) => !off.has(k));

  const filtered = withinDays(series, period.days);
  // Gles historik (t.ex. äldre sealed med en ensam arkivpunkt): har vald period
  // < 2 punkter men hela serien fler → visa hela istället för ett ensamt nuläge.
  const data = filtered.length < 2 && series.length >= 2 ? series : filtered;

  // Valda källor → serier för grafen. Perioden filtreras med samma regel som den
  // enkla serien: hellre hela historiken än en ensam punkt.
  const chartSeries: PriceChartSeries[] | undefined = available.length
    ? selected.map((key) => {
        const points = bySource?.[key] ?? [];
        const win = withinDays(points, period.days);
        return {
          key,
          label: t(`source_${key}` as never),
          color: SOURCE_COLORS[key],
          points: win.length < 2 && points.length >= 2 ? points : win,
        };
      })
    : undefined;
  // Enkelserie-vägen (yta, uttoning, endpoint-prick) behålls när exakt en källa
  // är vald — den är mer läsbar än en naken linje.
  const chartSingle = chartSeries?.length === 1 ? chartSeries[0].points : data;

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
          {PERIODS.map((p) => {
            const locked = p.value === "max" && !isPro;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => (locked ? router.push("/priser") : setPeriod(p))}
                aria-current={p.value === period.value ? "true" : undefined}
                title={locked ? t("maxProOnly") : undefined}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                  p.value === period.value
                    ? "bg-holo-cyan/15 text-holo-cyan"
                    : locked
                      ? "text-ink-faint hover:text-holo-cyan"
                      : "text-ink-muted hover:text-ink"
                )}
              >
                {locked && <IconLock size={11} />}
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {/* data-swipe-ignore: horisontellt drag på grafen = tooltip-scrubbing,
            inte svep-tillbaka (overlayns gest hoppar över den här ytan). */}
        {available.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("sourceFilter")}>
            {available.map((key) => {
              const on = !off.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      // Minst en källa måste vara vald — annars står man inför en
                      // tom ruta utan att förstå varför.
                      if (!next.has(key) && selected.length === 1) return prev;
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                    on
                      ? "border-surface-border bg-surface-overlay text-ink"
                      : "border-surface-border/60 text-ink-faint hover:text-ink-muted"
                  )}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full transition-opacity"
                    style={{ backgroundColor: SOURCE_COLORS[key], opacity: on ? 1 : 0.3 }}
                  />
                  {t(`source_${key}` as never)}
                </button>
              );
            })}
          </div>
        )}
        <div data-swipe-ignore>
          <PriceChartLazy data={chartSingle} series={chartSeries} />
        </div>
      </CardContent>
    </Card>
  );
}
