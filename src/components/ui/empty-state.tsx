import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  // Standardtexterna följer språket — en hårdkodad svensk fallback dök upp mitt i
  // det engelska gränssnittet så fort en anropare utelämnade `title`.
  const t = useTranslations("Common");
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
      <h3 className="font-display text-lg font-semibold text-ink">{title ?? t("emptyTitle")}</h3>
      <p className="max-w-sm text-sm text-ink-muted">{description ?? t("emptyDescription")}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
