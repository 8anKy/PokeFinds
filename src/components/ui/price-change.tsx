import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { IconTrendingDown, IconTrendingUp } from "@/components/ui/icons";

export interface PriceChangeProps {
  percent: number;
  className?: string;
  /** Dölj upp/ner-pilen (tecknet +/− bär ändå riktningen). Default: visa pil. */
  hideIcon?: boolean;
}

/** Visar prisförändring med pil och färg: grön upp, röd ner, neutral nära noll. */
export function PriceChange({ percent, className, hideIcon = false }: PriceChangeProps) {
  const isFlat = Math.abs(percent) < 0.05;
  const isUp = percent > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium tabular-nums",
        isFlat ? "text-ink-muted" : isUp ? "text-rise" : "text-fall",
        className
      )}
      title={isFlat ? "Oförändrat pris" : isUp ? "Priset har gått upp" : "Priset har gått ner"}
    >
      {!isFlat &&
        !hideIcon &&
        (isUp ? (
          <IconTrendingUp size={14} className="shrink-0" />
        ) : (
          <IconTrendingDown size={14} className="shrink-0" />
        ))}
      {formatPercent(percent)}
    </span>
  );
}
