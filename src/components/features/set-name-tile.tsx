/**
 * Namnbricka för set UTAN riktig logga (`isRealSetLogo`): setets namn som ordbild och koden
 * som en liten folieplatta — i stället för ett kort, en boosterpåse eller ett butiksfoto.
 * Ritas på rutans eget sken, så den följer erans ton.
 */
import { cn } from "@/lib/utils";
import { splitSetCode } from "@/lib/set-logo";

export function SetNameTile({ name, className, compact = false }: { name: string; className?: string; compact?: boolean }) {
  const { title, code } = splitSetCode(name);
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center", className)}>
      <span
        className={cn(
          "line-clamp-2 bg-gradient-to-br from-white via-white to-holo-cyan bg-clip-text font-display font-extrabold uppercase leading-tight tracking-tight text-transparent",
          compact ? "text-[11px]" : "text-sm sm:text-base"
        )}
      >
        {title}
      </span>
      {code && (
        <span className="rounded border border-holo-cyan/40 bg-black/40 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider text-holo-cyan">
          {code}
        </span>
      )}
    </div>
  );
}
