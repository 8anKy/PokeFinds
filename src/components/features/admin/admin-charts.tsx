"use client";

/**
 * Adminöversiktens diagram. Klientkomponent: recharts behöver DOM, och grafer är
 * interaktiva av princip (hover-tooltip på varje märke, klickbara reglage).
 *
 * ⛔ ALDRIG TVÅ Y-AXLAR. "Nya konton per dag" och "Totalt antal konton" är två
 * skalor och därför två LÄGEN i samma graf, aldrig två axlar i samma bild —
 * dubbelaxlar låter vem som helst få två serier att korsa varandra var som helst.
 * ⛔ Text bär textfärg, aldrig seriens färg: siffror och etiketter i ink-tokens,
 * så identiteten hänger på färgprickens plats bredvid dem och inte på färgen i
 * sig.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { cn } from "@/lib/utils";
import type { DailyPoint } from "@/services/admin/overview";
import { EVENT_SERIES, GRID, SINGLE, SURFACE, TICK } from "./chart-palette";

const nf = new Intl.NumberFormat("sv-SE");

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Gemensam tooltip-ruta. Samma yta och kant som `card-surface`. */
function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 shadow-card">
      <p className="text-xs font-medium text-ink">{title}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <p key={r.label} className="flex items-center gap-2 text-xs text-ink-muted">
            {r.color && (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
            )}
            <span>{r.label}</span>
            <span className="ml-auto font-semibold text-ink">{r.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/** Segmenterad kontroll — samma form som adminnavigeringen och periodväljarna. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-lg border border-surface-border bg-surface-raised p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
            value === o.value
              ? "bg-surface-overlay text-holo-cyan shadow-card"
              : "text-ink-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Fyller luckor i en dygnsserie med nollor.
 *
 * ⛔ UTAN DEN LJUGER GRAFEN. Postgres returnerar bara dygn som HAR rader, och
 * recharts fördelar punkterna jämnt över x-axeln — en vecka utan registreringar
 * ritades då som en jämn linje mellan två aktiva dagar i stället för som en
 * platt nolla. Datumen är UTC-dygn, samma nyckel som databasen grupperar på.
 */
export function fillDays(points: DailyPoint[], days: number): DailyPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: DailyPoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
    out.push({ date: d, value: byDate.get(d) ?? 0 });
  }
  return out;
}

type RangeKey = "30" | "90";
type GrowthMode = "new" | "total";

export function UserGrowthChart({
  signups,
  usersBeforeWindow,
}: {
  signups: DailyPoint[];
  usersBeforeWindow: number;
}) {
  const [range, setRange] = useState<RangeKey>("30");
  const [mode, setMode] = useState<GrowthMode>("new");
  const days = Number(range);

  const data = useMemo(() => {
    const filled = fillDays(signups, days);
    if (mode === "new") return filled;
    // Kumulativt: börja på antalet konton som fanns när fönstret öppnade, inte
    // på noll. Allt före fönstret ligger i `usersBeforeWindow`.
    const dropped = signups
      .filter((p) => !filled.some((f) => f.date === p.date))
      .reduce((s, p) => s + p.value, 0);
    let running = usersBeforeWindow + dropped;
    return filled.map((p) => {
      running += p.value;
      return { date: p.date, value: running };
    });
  }, [signups, days, mode, usersBeforeWindow]);

  const total = useMemo(() => fillDays(signups, days).reduce((s, p) => s + p.value, 0), [signups, days]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {mode === "new"
            ? `${nf.format(total)} nya konton på ${days} dagar`
            : `Totalt ${nf.format(data.at(-1)?.value ?? 0)} konton`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Visningsläge"
            value={mode}
            onChange={setMode}
            options={[
              { value: "new", label: "Nya" },
              { value: "total", label: "Totalt" },
            ]}
          />
          <Segmented
            label="Tidsspann"
            value={range}
            onChange={setRange}
            options={[
              { value: "30", label: "30 d" },
              { value: "90", label: "90 d" },
            ]}
          />
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        {mode === "new" ? (
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "#ffffff10" }}
              content={(p: TooltipProps<number, string>) =>
                p.active && p.payload?.length ? (
                  <TipBox
                    title={shortDate(String(p.label))}
                    rows={[
                      {
                        label: "Nya konton",
                        value: nf.format(Number(p.payload[0].value ?? 0)),
                        color: SINGLE,
                      },
                    ]}
                  />
                ) : null
              }
            />
            {/* 4px rundade toppar, förankrade i baslinjen. */}
            <Bar dataKey="value" fill={SINGLE} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="adminGrowthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SINGLE} stopOpacity={0.28} />
                <stop offset="100%" stopColor={SINGLE} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              domain={["dataMin - 2", "auto"]}
            />
            <Tooltip
              cursor={{ stroke: TICK, strokeDasharray: "3 3" }}
              content={(p: TooltipProps<number, string>) =>
                p.active && p.payload?.length ? (
                  <TipBox
                    title={shortDate(String(p.label))}
                    rows={[
                      {
                        label: "Konton totalt",
                        value: nf.format(Number(p.payload[0].value ?? 0)),
                        color: SINGLE,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={SINGLE}
              strokeWidth={2}
              fill="url(#adminGrowthFill)"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Aktivitet per dygn, staplat per händelsetyp.
 *
 * Legenden är KLICKBAR: en avbockad serie försvinner ur stapeln men behåller sin
 * färg (färg följer entiteten) — de kvarvarande målas alltså aldrig om.
 */
export function ActivityChart({
  events,
}: {
  events: { date: string; eventType: string; value: number }[];
}) {
  const [range, setRange] = useState<RangeKey>("30");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const days = Number(range);

  const visible = EVENT_SERIES.filter((s) => !hidden.has(s.key));

  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const row of events) {
      const bucket = byDate.get(row.date) ?? {};
      bucket[row.eventType] = (bucket[row.eventType] ?? 0) + row.value;
      byDate.set(row.date, bucket);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const out: Record<string, number | string>[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
      const bucket = byDate.get(d) ?? {};
      const row: Record<string, number | string> = { date: d };
      for (const s of EVENT_SERIES) row[s.key] = bucket[s.key] ?? 0;
      out.push(row);
    }
    return out;
  }, [events, days]);

  const windowTotal = useMemo(
    () =>
      data.reduce(
        (sum, row) => sum + visible.reduce((s, ser) => s + Number(row[ser.key] ?? 0), 0),
        0
      ),
    [data, visible]
  );

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      // ⛔ Släck aldrig den sista serien — en tom graf ser ut som ett datafel.
      if (next.has(key)) next.delete(key);
      else if (EVENT_SERIES.length - next.size > 1) next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {nf.format(windowTotal)} händelser på {days} dagar
        </p>
        <Segmented
          label="Tidsspann"
          value={range}
          onChange={setRange}
          options={[
            { value: "30", label: "30 d" },
            { value: "90", label: "90 d" },
          ]}
        />
      </div>

      {/* Legend som filter. Alltid närvarande vid ≥2 serier — identiteten får
          aldrig hänga på färgen ensam. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {EVENT_SERIES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={!off}
              className={cn(
                "flex items-center gap-1.5 text-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
                off ? "opacity-40" : "opacity-100"
              )}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className={off ? "text-ink-faint line-through" : "text-ink-muted"}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "#ffffff10" }}
            content={(p: TooltipProps<number, string>) => {
              if (!p.active || !p.payload?.length) return null;
              const rows = visible
                .map((s) => ({
                  label: s.label,
                  value: nf.format(
                    Number(p.payload?.find((x) => x.dataKey === s.key)?.value ?? 0)
                  ),
                  color: s.color,
                }))
                .filter((r) => r.value !== "0");
              const sum = p.payload.reduce((s, x) => s + Number(x.value ?? 0), 0);
              return (
                <TipBox
                  title={shortDate(String(p.label))}
                  rows={rows.length ? [...rows, { label: "Totalt", value: nf.format(sum) }] : [{ label: "Inga händelser", value: "0" }]}
                />
              );
            }}
          />
          {visible.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color}
              // 2px mellanrum i ytans färg mellan staplade segment; översta
              // segmentet får rundad topp.
              stroke={SURFACE}
              strokeWidth={1}
              radius={i === visible.length - 1 ? [4, 4, 0, 0] : undefined}
              maxBarSize={22}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Skanningar per dygn — samma form som tillväxtgrafen, egen serie.
 * Skannern är den funktion flest användare rör, så volymen är den bästa
 * enskilda pulsmätaren på om folk faktiskt använder appen.
 */
export function ScanChart({ scans }: { scans: DailyPoint[] }) {
  const [range, setRange] = useState<RangeKey>("30");
  const days = Number(range);
  const data = useMemo(() => fillDays(scans, days), [scans, days]);
  const total = useMemo(() => data.reduce((s, p) => s + p.value, 0), [data]);
  const peak = useMemo(() => Math.max(...data.map((p) => p.value), 0), [data]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {nf.format(total)} skanningar på {days} dagar · toppdygn {nf.format(peak)}
        </p>
        <Segmented
          label="Tidsspann"
          value={range}
          onChange={setRange}
          options={[
            { value: "30", label: "30 d" },
            { value: "90", label: "90 d" },
          ]}
        />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: TICK, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "#ffffff10" }}
            content={(p: TooltipProps<number, string>) =>
              p.active && p.payload?.length ? (
                <TipBox
                  title={shortDate(String(p.label))}
                  rows={[
                    {
                      label: "Skanningar",
                      value: nf.format(Number(p.payload[0].value ?? 0)),
                      color: SINGLE,
                    },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={22}>
            {/* Toppdygnet markeras — det är alltid det man vill kunna peka på. */}
            {data.map((p) => (
              <Cell
                key={p.date}
                fill={SINGLE}
                fillOpacity={peak > 0 && p.value === peak ? 1 : 0.72}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
