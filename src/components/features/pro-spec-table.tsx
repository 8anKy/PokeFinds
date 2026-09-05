import { IconCheck } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { SPEC_NO, SPEC_YES, type SpecRow } from "@/lib/pricing-features";

/**
 * Free mot Pro som specifikationsblad — en rad per förmån, två värdekolumner.
 *
 * Ersätter de två punktlistorna (en med gröna bockar, en med överstrukna rader):
 * det här svarar på "vad får jag" i EN blick och sätter planerna bredvid
 * varandra i stället för i två kort. Ingen hook, ingen klientkod → används både
 * av serversidan `/priser` och av paywall-arket.
 *
 * Raderna kommer ALLTID ur `pausableFeatures()` hos anroparen — larm-raderna
 * ligger i egna listor och konkateneras in bara när flaggan säger att larmen
 * går. Se `lib/pricing-features.ts`.
 */
export function ProSpecTable({
  rows,
  freeLabel,
  proLabel,
  compact = false,
  className,
}: {
  rows: readonly SpecRow[];
  freeLabel: string;
  proLabel: string;
  compact?: boolean;
  className?: string;
}) {
  const grid = "grid grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2";
  return (
    <div className={cn("overflow-hidden rounded-xl border border-surface-border bg-surface", className)} role="table">
      <div
        role="row"
        className={cn(grid, "border-b border-surface-border px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint")}
      >
        <span role="columnheader" />
        <span role="columnheader" className="text-center">
          {freeLabel}
        </span>
        <span role="columnheader" className="text-center text-holo-cyan">
          {proLabel}
        </span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.label}
          role="row"
          className={cn(grid, "px-3", compact ? "py-1.5" : "py-2", i > 0 && "border-t border-surface-border/60")}
        >
          <span role="cell" className={cn("text-ink-muted", compact ? "text-[12.5px]" : "text-[13px]")}>
            {r.label}
          </span>
          <SpecValue value={r.free} tone="free" />
          <SpecValue value={r.pro} tone="pro" />
        </div>
      ))}
    </div>
  );
}

function SpecValue({ value, tone }: { value: string; tone: "free" | "pro" }) {
  const pro = tone === "pro";
  const base = cn(
    "flex h-7 items-center justify-center rounded-md text-[12.5px] font-semibold tabular-nums",
    pro ? "bg-holo-cyan/[0.08] text-holo-cyan" : "text-ink-faint"
  );
  if (value === SPEC_YES) {
    return (
      <span role="cell" className={base} aria-label={value}>
        <IconCheck size={15} className={pro ? "text-holo-cyan" : "text-ink-muted"} />
      </span>
    );
  }
  if (value === SPEC_NO) {
    return (
      <span role="cell" className={cn(base, "text-ink-faint/60")}>
        {value}
      </span>
    );
  }
  return (
    <span role="cell" className={base}>
      {value}
    </span>
  );
}
