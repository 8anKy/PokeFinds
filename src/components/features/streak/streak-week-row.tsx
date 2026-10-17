"use client";

import { cn } from "@/lib/utils";

export interface WeekDot {
  done: boolean;
  isToday: boolean;
  isFuture: boolean;
}

function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.6 4.6L19 7.6" stroke="#042f2e" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Måndag → söndag. Gjord dag = turkos bubbla med bock, idag ogjord = pulserande ring,
 * passerad ogjord = grå, kommande = tunn ring. `popIndex` spelar in bubblan som just
 * blev gjord (firandet och kortet när användaren kommer tillbaka).
 */
export function StreakWeekRow({
  days,
  letters,
  todayLabel,
  popIndex = -1,
  size = 36,
  popDelayMs = 0,
  compact = false,
}: {
  days: WeekDot[];
  letters: string[];
  todayLabel: string;
  popIndex?: number;
  size?: number;
  popDelayMs?: number;
  /** Kortets smala rad: tätare, mindre bokstäver, dagens bokstav i stället för "Idag". */
  compact?: boolean;
}) {
  return (
    <ol className={cn("grid grid-cols-7", compact ? "gap-1" : "gap-1.5")} aria-label={days.map((d, i) => `${letters[i]}: ${d.done ? "✓" : "–"}`).join(", ")}>
      {days.map((d, i) => {
        const popping = i === popIndex && d.done;
        return (
          <li key={i} className={cn("flex flex-col items-center", compact ? "gap-1" : "gap-1.5")}>
            <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
              {d.done ? (
                <span
                  className={cn("flex h-full w-full items-center justify-center rounded-full", popping && "streak-pop")}
                  style={{
                    background: "linear-gradient(180deg, #5eead4 0%, #14b8a6 100%)",
                    boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), 0 2px 10px -2px rgba(45,212,191,0.55)",
                    animationDelay: popping ? `${popDelayMs}ms` : undefined,
                  }}
                >
                  <Check size={Math.round(size * 0.5)} />
                </span>
              ) : d.isToday ? (
                <span
                  className={cn("streak-ring-pulse h-full w-full rounded-full border-dashed", compact ? "border-2" : "border-[2.5px]")}
                  style={{ borderColor: "#2dd4bf" }}
                />
              ) : d.isFuture ? (
                <span className="h-full w-full rounded-full border-2 border-surface-border" />
              ) : (
                <span className="h-full w-full rounded-full bg-surface-overlay" />
              )}
              {popping && <Sparks delayMs={popDelayMs} />}
            </span>
            <span
              className={cn(
                compact ? "text-[9px] font-bold uppercase leading-none" : "text-[11px] font-bold uppercase leading-none tracking-wide",
                d.isToday ? "text-[#2dd4bf]" : d.done ? "text-ink" : "text-ink-faint"
              )}
            >
              {d.isToday && !compact ? todayLabel : letters[i]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const SPARKS = [
  { dx: "-26px", dy: "-22px", c: "#ffd84a" },
  { dx: "24px", dy: "-24px", c: "#2dd4bf" },
  { dx: "30px", dy: "6px", c: "#2dd4bf" },
  { dx: "-30px", dy: "8px", c: "#2dd4bf" },
  { dx: "2px", dy: "-34px", c: "#fff3b0" },
  { dx: "-14px", dy: "26px", c: "#ffd84a" },
  { dx: "16px", dy: "26px", c: "#2dd4bf" },
];

/** Gnistor som skjuts ut när en bubbla fylls. Ren CSS, inga beroenden. */
export function Sparks({ delayMs = 0, scale = 1 }: { delayMs?: number; scale?: number }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="streak-spark absolute rounded-full"
          style={
            {
              width: 6 * scale,
              height: 6 * scale,
              background: s.c,
              boxShadow: `0 0 8px ${s.c}`,
              "--dx": `calc(${s.dx} * ${scale})`,
              "--dy": `calc(${s.dy} * ${scale})`,
              animationDelay: `${delayMs + 180 + i * 18}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
