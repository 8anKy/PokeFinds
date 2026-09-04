"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from "@/components/ui/icons";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ title, description, onRetry, retryLabel, className }: ErrorStateProps) {
  const t = useTranslations("Common");
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-fall/30 bg-fall/5 px-6 py-14 text-center",
        className
      )}
    >
      <div aria-hidden="true" className="text-fall">
        <IconAlertTriangle size={32} />
      </div>
      <h3 className="font-display text-lg font-semibold text-ink">{title ?? t("errorTitle")}</h3>
      <p className="max-w-sm text-sm text-ink-muted">{description ?? t("errorDescription")}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          {retryLabel ?? t("retry")}
        </Button>
      )}
    </div>
  );
}
