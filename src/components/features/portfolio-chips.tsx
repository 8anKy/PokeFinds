"use client";

import { useTranslations } from "next-intl";
import { IconPlus } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { PortfolioSummary } from "@/lib/portfolios-client";

/**
 * Pärmväljaren: en rad chips, en per pärm, samma form som skick-chipsen i
 * samlingens exemplarark. Ett valfritt "+" sist öppnar "Ny pärm" — eller
 * paywall-arket när planen är full (anroparen avgör, chipen visas ändå: en
 * gratisanvändare ska SE att det finns fler pärmar att få).
 *
 * `value` är ALLTID ett pärm-id (standardpärmen har ett); översättningen till
 * `portfolioId = null` sker på servern. `allOption` lägger "Alla" först med
 * värdet null — bara /samling vill det, skannern och snabbtillägget måste välja EN.
 */
export function PortfolioChips({
  portfolios,
  value,
  onChange,
  onCreate,
  allOption = false,
  counts = false,
  size = "md",
  className,
}: {
  portfolios: PortfolioSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate?: () => void;
  allOption?: boolean;
  /** Visa antal poster i chipen. */
  counts?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useTranslations("Portfolios");
  const chip = (active: boolean) =>
    cn(
      "shrink-0 whitespace-nowrap rounded-full font-semibold transition-colors",
      size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
      active ? "bg-holo-cyan text-surface" : "bg-surface-overlay text-ink-muted hover:text-ink"
    );
  return (
    <div
      role="radiogroup"
      aria-label={t("pickerLabel")}
      className={cn("flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {allOption && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={chip(value === null)}
        >
          {t("all")}
        </button>
      )}
      {portfolios.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          onClick={() => onChange(p.id)}
          className={chip(value === p.id)}
        >
          {p.name}
          {counts && (
            <span className={cn("ml-1.5 tabular-nums", value === p.id ? "opacity-70" : "text-ink-faint")}>
              {p.itemCount}
            </span>
          )}
        </button>
      ))}
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          aria-label={t("newBinder")}
          className={cn(chip(false), "inline-flex items-center gap-1 text-holo-cyan")}
        >
          <IconPlus size={size === "sm" ? 12 : 14} />
          {t("newBinderShort")}
        </button>
      )}
    </div>
  );
}
