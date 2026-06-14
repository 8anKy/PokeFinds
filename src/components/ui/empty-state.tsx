import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title = "Här var det tomt",
  description = "Vi hittade inget att visa just nu. Prova att ändra dina filter eller kom tillbaka senare.",
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-surface-border px-6 py-14 text-center",
        className
      )}
    >
      {icon && (
        <div className="text-ink-faint" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
