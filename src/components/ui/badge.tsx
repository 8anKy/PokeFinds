import type { HTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "success" | "danger" | "warning" | "info" | "holo";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-surface-overlay text-ink-muted border border-surface-border",
  success: "bg-rise/15 text-rise border border-rise/30",
  danger: "bg-fall/15 text-fall border border-fall/30",
  warning: "bg-holo-gold/15 text-holo-gold border border-holo-gold/30",
  info: "bg-holo-cyan/15 text-holo-cyan border border-holo-cyan/30",
  holo: "relative border border-transparent text-ink [background:linear-gradient(#141417,#141417)_padding-box,linear-gradient(135deg,#2dd4bf,#14b8a6,#0f766e)_border-box]",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

export type StockStatus = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "LIMITED" | "UNKNOWN";

const stockVariants: Record<StockStatus, BadgeVariant> = {
  IN_STOCK: "success", // grön
  OUT_OF_STOCK: "warning", // amber — t.ex. sealed utan aktuell annons (visar 30d-snitt)
  PREORDER: "info",
  LIMITED: "warning",
  UNKNOWN: "default",
};

export interface StockBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  stockStatus: StockStatus | string | null | undefined;
}

export function StockBadge({ stockStatus, className, ...props }: StockBadgeProps) {
  const t = useTranslations("Stock");
  const status: StockStatus =
    stockStatus && stockStatus in stockVariants ? (stockStatus as StockStatus) : "UNKNOWN";
  return (
    <Badge variant={stockVariants[status]} className={className} {...props}>
      {t(status)}
    </Badge>
  );
}
