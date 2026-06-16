"use client";

import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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

export interface PriceChartProps {
  data: PriceChartPoint[];
  className?: string;
}

const LINE = "#2dd4bf"; // turquoise — brand signature line
const GRID = "#26262b"; // subtle neutral guide line
const TICK = "#8a8a93"; // muted neutral axis label
const SURFACE = "#0a0a0c"; // page background (endpoint halo cutout)

function shortDate(d: string, withYear = false): string {
  return new Date(d).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function ChartTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-lg bg-surface-raised px-3.5 py-2 shadow-xl ring-1 ring-white/10">
      <p className="text-[11px] font-medium text-ink-muted">
        {shortDate(String(label), true)}
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

export function PriceChart({ data, className }: PriceChartProps) {
  const uid = useId().replace(/:/g, "");
  const lineFadeId = `lf-${uid}`;
  const areaFillId = `af-${uid}`;
  const cursorId = `cu-${uid}`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <EmptyState
        title="Ingen prishistorik ännu"
        description="Vi har inte samlat in tillräckligt med prisdata för den här produkten."
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
          Senaste marknadspris ·{" "}
          {shortDate(
            data[0].date,
            data[0].date.slice(0, 4) !== String(new Date().getFullYear())
          )}
        </p>
        <p className="mt-1 font-display text-4xl font-bold text-ink" data-price>
          {formatPrice(data[0].price)}
        </p>
        <p className="mt-3 max-w-xs text-xs text-ink-faint">
          Historiken byggs upp automatiskt — kurvan visas när fler mätpunkter
          har samlats in.
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
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={data}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
          onMouseMove={(state) => {
            const i = state?.activeTooltipIndex;
            setActiveIndex(typeof i === "number" ? i : null);
          }}
          onMouseLeave={() => setActiveIndex(null)}
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
              <stop offset="0%" stopColor={LINE} stopOpacity={0.13} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={cursorId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0} />
              <stop offset="12%" stopColor={LINE} stopOpacity={0.55} />
              <stop offset="88%" stopColor={LINE} stopOpacity={0.55} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => shortDate(d, spansYears)}
            tick={{ fill: TICK, fontSize: 11 }}
            angle={-40}
            textAnchor="end"
            height={48}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={formatTick}
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={<ChartCursor gradientId={cursorId} />}
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
