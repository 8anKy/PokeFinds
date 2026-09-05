"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { hapticGlide } from "@/lib/haptics";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { formatPrice } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";

export interface PriceChartPoint {
  date: string;
  price: number; // i öre
}

/** En namngiven, färgsatt serie. Färgen följer KÄLLAN, aldrig ordningen — en
 *  avbockad källa får aldrig måla om de kvarvarande. */
export interface PriceChartSeries {
  key: string;
  label: string;
  color: string;
  points: PriceChartPoint[];
}

export interface PriceChartProps {
  data: PriceChartPoint[];
  /** Fler än en serie → överlagrat läge med en linje per källa. En enda serie
   *  ritas som förut (yta, uttoning, endpoint-prick), fast i källans färg. */
  series?: PriceChartSeries[];
  className?: string;
  /** Månadsaggregerad serie → visa "mån åååå" på axeln (utan vilseledande dag). */
  monthly?: boolean;
  /** Avskalad variant (portfölj): döljer rutnät + y-axelns siffror, behåller
   *  linje/datum/endpoint/tooltip. Y-domänen skalas fortfarande till datat. */
  minimal?: boolean;
  /**
   * Produktvyns ark (2026-09-05): döljer rutnät + y-axelns siffror men BEHÅLLER
   * datumaxeln; högsta/lägsta i fönstret ritas som två svaga guidelinjer med
   * en etikett i högerkanten. Tre siffror i vänsterkanten var brus bredvid priset.
   */
  quiet?: boolean;
  /**
   * Tomtillståndets text. Standardtexten talar om "den här produkten" — på
   * samlingens värdegraf var det fel subjekt (QA 2026-09-05), så anroparen får
   * sätta sin egen.
   */
  emptyDescription?: string;
}

const BRAND_LINE = "#2dd4bf"; // turquoise — brand signature line
const LINE = BRAND_LINE; // används av tooltip/legend utanför komponenten
const GRID = "#26262b"; // subtle neutral guide line
const TICK = "#8a8a93"; // muted neutral axis label
const SURFACE = "#0a0a0c"; // page background (endpoint halo cutout)

function shortDate(d: string, withYear = false, monthly = false, dateLocale = "sv-SE"): string {
  return new Date(d).toLocaleDateString(dateLocale, {
    ...(monthly ? {} : { day: "numeric" }),
    month: "short",
    ...(withYear || monthly ? { year: "numeric" } : {}),
  });
}

/**
 * Y-axelns bredd måste rymma den längsta ticketiketten. Fast 48px klippte
 * tusentalsgruppen mot SVG-kanten: "3 284,91" ritades som "284,91" (mätt
 * 2026-08-09 på en JP-box vars hela spann låg kring 3 284,89 kr → 2 decimaler).
 * 1,05× tar höjd för att auto-domänen rundar översta ticken uppåt förbi en
 * siffergräns (999,95 → 1 000).
 */
function yAxisWidth(maxPriceOre: number, decimals: number): number {
  const sample = ((maxPriceOre * 1.05) / 100).toLocaleString("sv-SE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return Math.max(40, Math.ceil(sample.length * 6.5) + 10);
}

/** Högsta/lägsta i fönstret som svaga guidelinjer (quiet-läget). Etiketten avrundas till hela kronor. */
function guideLines(prices: number[]) {
  if (prices.length < 2) return null;
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  if (max === min) return null;
  const label = (v: number) => formatPrice(Math.round(v / 100) * 100);
  return (
    <>
      <ReferenceLine y={max} stroke={GRID} strokeDasharray="3 4" label={{ value: label(max), position: "insideTopRight", fill: TICK, fontSize: 10 }} />
      <ReferenceLine y={min} stroke={GRID} strokeDasharray="3 4" label={{ value: label(min), position: "insideBottomRight", fill: TICK, fontSize: 10 }} />
    </>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  monthly = false,
  dateLocale = "sv-SE",
}: TooltipProps<number, string> & { monthly?: boolean; dateLocale?: string }) {
  /**
   * HAPTIKEN BOR HÄR, INTE I `onMouseMove`.
   *
   * Recharts syntetiserar INTE mus-events från touch (och typar inga
   * touch-props på diagrammet), så en `onMouseMove`-baserad tick fungerade bara
   * med mus — mätt i fält 2026-08-02: långtrycken vibrerade på iPhone, grafen
   * gjorde det inte, varken i portföljen eller på produktsidan. Tooltipen
   * däremot renderas av recharts för BÅDA inmatningssätten, så dess egen
   * rendering är den enda signal som är sann på touch. Gäller båda graferna:
   * portföljvärdet och produktens prishistorik delar den här komponenten.
   *
   * ⛔ Per DATAPUNKT, aldrig per pixel: `label` byts först när markören flyttat
   * till en ny dag. En vibration per renderrunda hade surrat konstant.
   */
  const lastLabel = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      // Nollställ när fingret lyfts, annars är nästa beröring på SAMMA dag tyst.
      lastLabel.current = null;
      return;
    }
    const key = label == null ? null : String(label);
    if (key !== null && key !== lastLabel.current) {
      lastLabel.current = key;
      hapticGlide();
    }
  }, [active, label]);

  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-lg bg-surface-raised px-3.5 py-2 shadow-xl ring-1 ring-white/10">
      <p className="text-[11px] font-medium text-ink-muted">
        {shortDate(String(label), true, monthly, dateLocale)}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-1 rounded-full"
          style={{ backgroundColor: LINE }}
        />
        <span className="text-sm font-semibold text-white" data-price>
          {typeof value === "number" ? formatPrice(value) : "–"}
        </span>
      </div>
    </div>
  );
}

/**
 * Vertikal scrubbnings-markör: en tunn linje med mjuk uppåt/nedåt-tonad opacitet
 * så att den känns som ett ljus snarare än en hård linjal. Recharts skickar in
 * linjens två ändpunkter via `points`.
 */
function ChartCursor({
  points,
  gradientId,
}: {
  points?: { x: number; y: number }[];
  gradientId: string;
}) {
  if (!points || points.length < 2) return null;
  const x = points[0].x;
  return (
    <line
      x1={x}
      y1={points[0].y}
      x2={x}
      y2={points[1].y}
      stroke={`url(#${gradientId})`}
      strokeWidth={1.25}
    />
  );
}

/**
 * ÖVERLAGRAT LÄGE — flera källor i samma diagram.
 *
 * ⛔ EN AXEL, ALDRIG TVÅ. Alla serier är samma storhet i samma valuta (dagens
 * lägsta i öre), så de delar y-axel. Det är också hela skälet till att
 * `bucketObservationsBySource` bytte Tradera/butiker från dagsmedel till dagens
 * lägsta: ett snitt och ett golv på samma axel hade fått marknaden att se dyrare
 * ut än den är.
 *
 * Ingen yta här — fyra tonade ytor ovanpå varandra blir gyttja. Bara linjer.
 * `connectNulls` eftersom källorna har olika täta punkter: Cardmarket skriver
 * varje dag, Tradera bara de dagar en matchande annons fanns, och ett hål i en
 * serie ska inte klippa av den.
 */
function MultiSeriesChart({
  series,
  dateLocale,
  monthly,
  spansYears,
  quiet = false,
}: {
  series: PriceChartSeries[];
  dateLocale: string;
  monthly: boolean;
  spansYears: boolean;
  quiet?: boolean;
}) {
  const byKey = new Map(series.map((s) => [s.key, new Map(s.points.map((p) => [p.date, p.price]))]));
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const rows = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const s of series) row[s.key] = byKey.get(s.key)?.get(date) ?? null;
    return row;
  });
  const prices = series.flatMap((s) => s.points.map((p) => p.price));
  const range = Math.max(...prices) - Math.min(...prices);
  const decimals = range < 200 ? 2 : range < 1000 ? 1 : 0;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={rows} margin={{ top: 12, right: 30, bottom: 0, left: 0 }}>
        {!quiet && <CartesianGrid stroke={GRID} strokeDasharray="2 6" vertical={false} />}
        {quiet && guideLines(prices)}
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => shortDate(d, spansYears, monthly, dateLocale)}
          tick={{ fill: TICK, fontSize: 11 }}
          angle={quiet ? 0 : -40}
          textAnchor={quiet ? "middle" : "end"}
          height={quiet ? 22 : 48}
          axisLine={false}
          tickLine={false}
          minTickGap={quiet ? 64 : 28}
        />
        <YAxis
          hide={quiet}
          tickFormatter={(v: number) =>
            (v / 100).toLocaleString("sv-SE", {
              minimumFractionDigits: 0,
              maximumFractionDigits: decimals,
            })
          }
          tick={{ fill: TICK, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={yAxisWidth(Math.max(...prices), decimals)}
          domain={["auto", "auto"]}
        />
        <Tooltip
          content={<MultiTooltip series={series} monthly={monthly} dateLocale={dateLocale} />}
          cursor={{ stroke: GRID, strokeWidth: 1.25 }}
          position={{ y: 0 }}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            dot={false}
            activeDot={{ r: 4, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Tooltip för överlagrat läge: färgen sitter på PRICKEN, texten bär ink-tokens. */
function MultiTooltip({
  active,
  payload,
  label,
  series,
  monthly = false,
  dateLocale = "sv-SE",
}: TooltipProps<number, string> & {
  series: PriceChartSeries[];
  monthly?: boolean;
  dateLocale?: string;
}) {
  const lastLabel = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      lastLabel.current = null;
      return;
    }
    const key = label == null ? null : String(label);
    if (key !== null && key !== lastLabel.current) {
      lastLabel.current = key;
      hapticGlide();
    }
  }, [active, label]);

  if (!active || !payload || payload.length === 0) return null;
  const shown = payload.filter((p) => typeof p.value === "number");
  if (shown.length === 0) return null;
  return (
    <div className="rounded-lg bg-surface-raised px-3.5 py-2 shadow-xl ring-1 ring-white/10">
      <p className="text-[11px] font-medium text-ink-muted">
        {shortDate(String(label), true, monthly, dateLocale)}
      </p>
      <div className="mt-1 space-y-0.5">
        {shown.map((p) => {
          const s = series.find((x) => x.key === p.dataKey);
          return (
            <div key={String(p.dataKey)} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: s?.color ?? LINE }}
              />
              <span className="text-[11px] text-ink-muted">{s?.label}</span>
              <span className="ml-auto pl-3 text-sm font-semibold text-white" data-price>
                {formatPrice(p.value as number)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PriceChart({
  data,
  series,
  className,
  monthly = false,
  minimal = false,
  quiet = false,
  emptyDescription,
}: PriceChartProps) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  // Datumaxel följer språket (en-GB behåller dag-månad-ordningen "18 Jun");
  // y-axelns SIFFROR lämnas i sv-SE så de matchar SEK-rubriken (t.ex. "3 750,20 kr").
  const dateLocale = locale === "en" ? "en-GB" : "sv-SE";
  const uid = useId().replace(/:/g, "");
  const lineFadeId = `lf-${uid}`;
  const areaFillId = `af-${uid}`;
  const cursorId = `cu-${uid}`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // FÄRGEN FÖLJER KÄLLAN, inte ordningen: väljer man bara Tradera ska linjen vara
  // Traderas färg — annars läser den som Cardmarket.
  const LINE = series?.length === 1 ? series[0].color : BRAND_LINE;
  // Bara linjens uttoning. HAPTIKEN ligger i ChartTooltip — den är den enda
  // signalen recharts ger på BÅDE mus och touch. Se kommentaren där.
  const scrubTo = useCallback((state: { activeTooltipIndex?: number } | undefined) => {
    const i = state?.activeTooltipIndex;
    setActiveIndex(typeof i === "number" ? i : null);
  }, []);
  const endScrub = useCallback(() => setActiveIndex(null), []);

  const multi = series && series.length > 1 ? series.filter((s) => s.points.length > 0) : null;
  if (multi && multi.length > 1) {
    const all = multi.flatMap((s) => s.points.map((p) => p.date)).sort();
    return (
      <div className={className} onTouchEnd={endScrub} onTouchCancel={endScrub}>
        <MultiSeriesChart
          series={multi}
          dateLocale={dateLocale}
          monthly={monthly}
          spansYears={all.length > 0 && all[0].slice(0, 4) !== all[all.length - 1].slice(0, 4)}
          quiet={quiet}
        />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={t("chartEmptyTitle")}
        description={emptyDescription ?? t("chartEmptyDesc")}
        className={className}
      />
    );
  }

  // En ensam mätpunkt → visa som tydligt nuläge.
  if (data.length === 1) {
    return (
      <div
        className={`flex h-[300px] flex-col items-center justify-center text-center ${className ?? ""}`}
      >
        <p className="text-xs text-ink-muted">
          {t("chartLatest")} ·{" "}
          {shortDate(
            data[0].date,
            data[0].date.slice(0, 4) !== String(new Date().getFullYear()),
            monthly,
            dateLocale
          )}
        </p>
        <p className="mt-1 font-display text-4xl font-bold text-ink" data-price>
          {formatPrice(data[0].price)}
        </p>
        <p className="mt-3 max-w-xs text-xs text-ink-faint">
          {t("chartBuilding")}
        </p>
      </div>
    );
  }

  const lastIndex = data.length - 1;
  const spansYears =
    data[0].date.slice(0, 4) !== data[lastIndex].date.slice(0, 4);

  const prices = data.map((d) => d.price);
  const range = Math.max(...prices) - Math.min(...prices);
  const decimals = range < 200 ? 2 : range < 1000 ? 1 : 0;
  const formatTick = (v: number) =>
    (v / 100).toLocaleString("sv-SE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });

  // Brytpunkt för skärpa→tona-ut. Inget val (idle) → hela linjen skarp.
  const hovering = activeIndex !== null;
  const splitPct = `${(hovering ? activeIndex! / lastIndex : 1) * 100}%`;

  const endpointDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (index !== lastIndex || cx == null || cy == null) {
      return <g key={`dot-${index}`} />;
    }
    return (
      <g key={`dot-${index}`}>
        <circle cx={cx} cy={cy} r={6} fill={LINE} opacity={0.2} />
        <circle
          cx={cx}
          cy={cy}
          r={3}
          fill={LINE}
          stroke={SURFACE}
          strokeWidth={1.5}
        />
      </g>
    );
  };

  return (
    // Touchslut fångas HÄR, inte på diagrammet: recharts typar inga
    // touch-props, men wrappern är en vanlig DOM-nod. `onMouseLeave` fyras inte
    // av ett lyft finger, så utan den här skulle markören bli kvar efter draget.
    <div className={className} onTouchEnd={endScrub} onTouchCancel={endScrub}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={data}
          margin={{ top: 12, right: 30, bottom: 0, left: 0 }}
          // Recharts routar touch-dragningar genom sina EGNA mus-callbacks
          // (`onTouchMove` finns inte i dess typer) — därför räcker den här för
          // både mus och finger. Nollställningen vid touchslut ligger på
          // wrapper-diven nedan, som är en riktig DOM-nod.
          onMouseMove={scrubTo}
          onMouseLeave={endScrub}
        >
          <defs>
            {/* Horisontell stroke-gradient: skarp turkos fram till markören,
                mjuk uttoning till spöklik efter den. Tonstyrkan animeras
                (stop-opacity) vid hover in/ut. */}
            <linearGradient id={lineFadeId} x1="0" y1="0" x2="1" y2="0">
              {/* Skarp fram till markören, sedan KONSTANT uttonad hela vägen till
                  nu (ett hårt steg vid markören, inte en gradient som bleknar
                  bort) — lika "mörk" från vald dag fram till idag. */}
              <stop offset="0%" stopColor={LINE} stopOpacity={1} />
              <stop offset={splitPct} stopColor={LINE} stopOpacity={1} />
              <stop
                offset={splitPct}
                stopColor={LINE}
                stopOpacity={hovering ? 0.22 : 1}
                className="price-fade-stop"
              />
              <stop
                offset="100%"
                stopColor={LINE}
                stopOpacity={hovering ? 0.22 : 1}
                className="price-fade-stop"
              />
            </linearGradient>
            <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
              {/* Avskalad portföljvy → fylligare ton (kant-till-kant på bakgrunden). */}
              <stop offset="0%" stopColor={LINE} stopOpacity={minimal ? 0.3 : 0.13} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={cursorId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0} />
              <stop offset="12%" stopColor={LINE} stopOpacity={0.55} />
              <stop offset="88%" stopColor={LINE} stopOpacity={0.55} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          {!minimal && !quiet && <CartesianGrid stroke={GRID} strokeDasharray="2 6" vertical={false} />}
          {quiet && guideLines(prices)}
          {/* Quiet-läget: raka, glesa datum (tre–fyra) i stället för sex lutande. */}
          <XAxis
            hide={minimal}
            dataKey="date"
            tickFormatter={(d: string) => shortDate(d, spansYears, monthly, dateLocale)}
            tick={{ fill: TICK, fontSize: 11 }}
            angle={quiet ? 0 : -40}
            textAnchor={quiet ? "middle" : "end"}
            height={quiet ? 22 : 48}
            axisLine={false}
            tickLine={false}
            minTickGap={quiet ? 64 : 28}
          />
          <YAxis
            hide={minimal || quiet}
            tickFormatter={formatTick}
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={yAxisWidth(Math.max(...prices), decimals)}
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<ChartTooltip monthly={monthly} dateLocale={dateLocale} />}
            cursor={<ChartCursor gradientId={cursorId} />}
            // Nåla tooltipen vid toppen (y=0) så fingret aldrig täcker den; x följer
            // ändå scrubbningen. Recharts behåller spårning på axeln man inte sätter.
            position={{ y: 0 }}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={`url(#${lineFadeId})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${areaFillId})`}
            dot={hovering ? false : endpointDot}
            activeDot={{
              r: 4.5,
              fill: LINE,
              stroke: SURFACE,
              strokeWidth: 2.5,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
