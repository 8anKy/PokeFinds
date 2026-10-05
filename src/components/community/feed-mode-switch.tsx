"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FEED_MODES, type FeedMode } from "@/lib/community-feed-modes";

/**
 * Flödets filter (ägarbeslut 2026-10-05): EN rad med tre lika breda lägen, ingen
 * sidledsscroll. "I butik" får en egen växel för färska fynd — svaret på "var kan
 * jag köpa den just nu?".
 */
export function FeedModeSwitch({ mode, onMode, freshOnly, onFreshOnly }: {
  mode: FeedMode;
  onMode: (mode: FeedMode) => void;
  freshOnly: boolean;
  onFreshOnly: (on: boolean) => void;
}) {
  const t = useTranslations("LocalStores");
  const label: Record<FeedMode, string> = { all: t("feedModeAll"), stores: t("feedModeStores"), market: t("feedModeMarket") };
  return <div className="space-y-2.5">
    <div role="radiogroup" aria-label={t("feedModes")} className="grid grid-cols-3 gap-1 rounded-xl bg-surface-overlay/60 p-1">
      {FEED_MODES.map(m => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)}
        className={cn("min-h-9 rounded-lg text-sm font-semibold transition-colors", mode === m ? "bg-surface text-ink shadow-sm ring-1 ring-surface-border" : "text-ink-muted hover:text-ink")}>
        {label[m]}
      </button>)}
    </div>
    {mode === "stores" && <button type="button" role="switch" aria-checked={freshOnly} onClick={() => onFreshOnly(!freshOnly)}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-surface-border px-3.5 text-left">
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{t("freshOnly")}</span><span className="block text-xs text-ink-muted">{t("freshOnlyHint")}</span></span>
      <span aria-hidden="true" className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", freshOnly ? "bg-holo-cyan" : "bg-surface-overlay")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-transform", freshOnly ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
    </button>}
  </div>;
}
