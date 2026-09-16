/**
 * VISUELLA BYGGSTENAR FÖR ANVÄNDARDETALJEN (ägaren 2026-09-17: "svårt att
 * samla informationen snabbt — lägg till visuella element"). Rena
 * serverkomponenter: staplar och chips i CSS/SVG, inga bibliotek. Färg bär
 * ALDRIG identiteten ensam — varje chip har sin text, varje stapel sitt tal.
 */
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("sv-SE");

/** Kvotstapel: använt av taket. ≥ 90 % färgas gul — det är då kunden möter väggen. */
export function QuotaBar({
  label,
  used,
  limit,
  unlimited,
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  /** Pro säljs som obegränsat — visa antalet, ingen nedräkning. */
  unlimited: boolean;
  hint?: string;
}) {
  const frac = unlimited || limit <= 0 ? 0 : Math.min(1, used / limit);
  const warn = !unlimited && frac >= 0.9;
  return (
    <div title={hint}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink">{label}</span>
        <span className={cn("text-sm tabular-nums", warn ? "text-holo-gold" : "text-ink-muted")}>
          <strong className="text-ink">{nf.format(used)}</strong>
          {unlimited ? " · obegränsat" : ` / ${nf.format(limit)}`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-overlay">
        <div
          className={cn("h-full rounded-full transition-[width]", warn ? "bg-holo-gold" : "bg-holo-cyan")}
          style={{ width: unlimited ? (used > 0 ? "100%" : "0%") : `${frac * 100}%`, opacity: unlimited ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}

/** På/av som ett chip — läses på en tiondel av tiden mot "E-postnotiser … På". */
export function ToggleChip({ label, on, title }: { label: string; on: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        on ? "border-rise/30 bg-rise/10 text-rise" : "border-surface-border bg-surface-overlay text-ink-faint line-through"
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-rise" : "bg-ink-faint")} />
      {label}
    </span>
  );
}

/** Faktachip i huvudet: ett tillstånd, en färg, en text. */
export function FactChip({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "pro";
  title?: string;
}) {
  const cls = {
    neutral: "border-surface-border bg-surface-overlay text-ink-muted",
    good: "border-rise/30 bg-rise/10 text-rise",
    warn: "border-holo-gold/30 bg-holo-gold/10 text-holo-gold",
    pro: "border-holo-cyan/40 bg-holo-cyan/10 text-holo-cyan",
  }[tone];
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", cls)}>
      {children}
    </span>
  );
}

/**
 * Horisontella staplar för livstidsaktivitet: talet OCH en längd relativt det
 * största — så "9 bevakningar, 0 allt annat" syns som en bild, inte som en
 * kolumn siffror.
 */
export function BarList({ rows }: { rows: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-x-3 text-xs" title={r.hint}>
          <span className="truncate text-ink-muted">{r.label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
            <span className="block h-full rounded-full bg-holo-cyan/70" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-ink">{nf.format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tidslinje för prenumerationen: konto skapat → Pro sedan → förnyas/löper ut.
 * Tre punkter på en linje; datum under. "Idag" markeras som ett streck.
 */
export function SubscriptionTimeline({
  createdAt,
  proSince,
  until,
  untilLabel,
}: {
  createdAt: Date;
  proSince: Date | null;
  until: Date | null;
  untilLabel: string;
}) {
  const points = [
    { label: "Konto", date: createdAt },
    ...(proSince ? [{ label: "Pro sedan", date: proSince }] : []),
    ...(until ? [{ label: untilLabel, date: until }] : []),
  ];
  const now = Date.now();
  const t0 = Math.min(...points.map((p) => p.date.getTime()), now);
  const t1 = Math.max(...points.map((p) => p.date.getTime()), now);
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => `${((t - t0) / span) * 100}%`;
  const fmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });
  return (
    <div className="relative mt-2 h-14">
      <div className="absolute left-0 right-0 top-2 h-0.5 bg-surface-border" />
      {/* Idag */}
      <div className="absolute top-0 h-4 w-0.5 bg-ink-faint" style={{ left: x(now) }} title={`Idag · ${fmt.format(now)}`} />
      {points.map((p, i) => (
        <div
          key={p.label}
          className="absolute top-0 -translate-x-1/2 text-center"
          style={{ left: x(p.date.getTime()), transform: i === 0 ? "translateX(0)" : i === points.length - 1 ? "translateX(-100%)" : undefined }}
        >
          <span className="mx-auto block h-4 w-4 rounded-full border-2 border-holo-cyan bg-black" />
          <span className="mt-1 block whitespace-nowrap text-[11px] text-ink-muted">{p.label}</span>
          <span className="block whitespace-nowrap text-[11px] tabular-nums text-ink">{fmt.format(p.date)}</span>
        </div>
      ))}
    </div>
  );
}

/** Ren SVG-stapelgraf för ett kontos skanningar per dygn (fyllda luckor). */
export function DailyBars({ points, label }: { points: { date: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  const w = 100 / points.length;
  return (
    <div>
      <p className="mb-1 text-xs text-ink-faint">
        {nf.format(total)} {label} på {points.length} dagar · toppdygn {nf.format(max === 1 && total === 0 ? 0 : max)}
      </p>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-20 w-full" role="img" aria-label={`${label} per dygn`}>
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={i * w + w * 0.15}
            width={w * 0.7}
            y={28 - (p.value / max) * 26}
            height={(p.value / max) * 26}
            rx={0.4}
            className="fill-holo-cyan"
            opacity={p.value === 0 ? 0.08 : 0.9}
          >
            <title>{`${p.date}: ${p.value}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}
