"use client";

/**
 * Ringdiagram (donut) för DEL-AV-HELHET.
 *
 * ⛔ ANVÄND DEN BARA NÄR DELARNA FAKTISKT SUMMERAR TILL HELHETEN och antalet
 * segment är högst sex. Tre lagliga fall i adminpanelen: planfördelning
 * (varje konto tillhör exakt en grupp), aktivitetsmix (varje händelse har exakt
 * en typ) och kostnadsfördelning (varje krona hör till en tjänst).
 * ⛔ ALDRIG för tratten: de stegen är DELMÄNGDER av varandra, inte delar av en
 * helhet — en ring hade påstått att de summerar till 100 %.
 * ⛔ ALDRIG för två värden: en ring med två segment är en sämre variant av två
 * siffror. Och aldrig för att jämföra värden som ligger nära varandra — vinklar
 * är svårast av alla visuella jämförelser; då är en stapel rätt.
 *
 * Hålet bär totalen, så ringen svarar på både "hur mycket" och "hur fördelat" i
 * samma bild. Förklaringen listar varje segment med EXAKT värde och andel:
 * små segment ska gå att läsa som tal även när de knappt syns som yta, och
 * identiteten får aldrig hänga på färgen ensam.
 */

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { SURFACE } from "./chart-palette";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Färdigformaterat värde (t.ex. "1 234 kr"). Utan det visas råa antalet. */
  display?: string;
}

const nf = new Intl.NumberFormat("sv-SE");

/** Punkt på cirkeln. 0° = klockan tolv, medurs. */
function point(cx: number, cy: number, r: number, frac: number) {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number) {
  // Ett helt varv går inte att rita som EN båge (start och slut sammanfaller och
  // SVG ritar då ingenting) — anroparen renderar en ring i stället, se nedan.
  const large = to - from > 0.5 ? 1 : 0;
  const o1 = point(cx, cy, rOuter, from);
  const o2 = point(cx, cy, rOuter, to);
  const i2 = point(cx, cy, rInner, to);
  const i1 = point(cx, cy, rInner, from);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i1.x} ${i1.y}`,
    "Z",
  ].join(" ");
}

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  className,
}: {
  slices: DonutSlice[];
  /** Texten under totalen i hålet. */
  centerLabel: string;
  /** Totalen i hålet, färdigformaterad. Utan den summeras värdena. */
  centerValue?: string;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const gradientId = useId();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const visible = slices.filter((s) => s.value > 0);

  if (total <= 0) {
    return (
      <p className={cn("text-sm text-ink-faint", className)}>
        Ingen data för perioden ännu.
      </p>
    );
  }

  const SIZE = 168;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rOuter = 78;
  const rInner = 52;

  let cursor = 0;
  const arcs = visible.map((s) => {
    const frac = s.value / total;
    const from = cursor;
    cursor += frac;
    return { slice: s, from, to: cursor, frac };
  });

  const activeSlice = arcs.find((a) => a.slice.key === active);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-4", className)}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${centerLabel}: ${visible
          .map((s) => `${s.label} ${s.display ?? nf.format(s.value)}`)
          .join(", ")}`}
        className="shrink-0"
      >
        {arcs.length === 1 ? (
          // Ett enda segment = hela ringen. En båge från 0 till 1 ritar ingenting.
          <circle
            cx={cx}
            cy={cy}
            r={(rOuter + rInner) / 2}
            fill="none"
            stroke={arcs[0].slice.color}
            strokeWidth={rOuter - rInner}
          />
        ) : (
          arcs.map((a) => (
            <path
              key={a.slice.key}
              d={arcPath(cx, cy, rOuter, rInner, a.from, a.to)}
              fill={a.slice.color}
              /* 2px mellanrum i ytans färg mellan segmenten — samma regel som
                 de staplade staplarna. */
              stroke={SURFACE}
              strokeWidth={2}
              opacity={active && active !== a.slice.key ? 0.4 : 1}
              className="cursor-pointer transition-opacity duration-150"
              onMouseEnter={() => setActive(a.slice.key)}
              onMouseLeave={() => setActive(null)}
            />
          ))
        )}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-ink font-display text-xl font-bold"
          style={{ fontSize: 20 }}
        >
          {activeSlice
            ? `${(activeSlice.frac * 100).toFixed(activeSlice.frac < 0.01 ? 1 : 0)} %`
            : (centerValue ?? nf.format(total))}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-ink-faint"
          style={{ fontSize: 11 }}
        >
          {activeSlice ? activeSlice.slice.label : centerLabel}
        </text>
        <desc id={gradientId}>{centerLabel}</desc>
      </svg>

      {/* Förklaringen är också tabellen: exakt värde + andel per segment, så
          små segment går att läsa även när ytan är någon grad bred. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {visible.map((s) => {
          const frac = s.value / total;
          return (
            <li
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                "flex items-center gap-2 text-xs transition-opacity",
                active && active !== s.key ? "opacity-50" : "opacity-100"
              )}
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-muted">{s.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-ink">
                {s.display ?? nf.format(s.value)}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-ink-faint">
                {(frac * 100).toFixed(frac < 0.01 ? 1 : 0)} %
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
