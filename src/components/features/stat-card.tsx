import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  change?: number;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, change, icon, className }: StatCardProps) {
  return (
    <Card className={cn("flex items-start justify-between gap-3 p-5", className)}>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="mt-1 truncate font-display text-2xl font-bold tabular-nums text-ink">
          {value}
        </p>
        {change != null && <PriceChange percent={change} className="mt-1" />}
      </div>
      {icon && (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-holo-cyan/10 text-xl text-holo-cyan"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
    </Card>
  );
}
