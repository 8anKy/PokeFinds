"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { StreakState } from "@/lib/streak";
import { onStreakEvent } from "@/lib/streak-client";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { StreakFlame } from "./streak-flame";
import { StreakWeekRow } from "./streak-week-row";

type StreakPayload = StreakState & { isPro: boolean };

const SEEN_KEY = "scoutr:streak-seen";

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(day: string) {
  try {
    localStorage.setItem(SEEN_KEY, day);
  } catch {
    // privat läge — då poppar bubblan bara varje gång, inget går sönder
  }
}

/**
 * Veckoseriens rad överst på Utforska, under sidhuvudet och ovanför sökfältet.
 * EN smal rad (ägarbeslut 2026-10-18: kortet tog för mycket plats) — låga, antal
 * och veckans prickar; status, belöning och reglerna ligger i arket bakom ett tryck.
 * Renderas bara för inloggade (sidan avgör med sessionen den redan läser). Hämtar
 * sitt tillstånd en gång vid montering och igen när dagens första handling firats —
 * aldrig pollning.
 */
export function StreakCard({ className }: { className?: string }) {
  const t = useTranslations("Streak");
  const [data, setData] = useState<StreakPayload | null>(null);
  const [popToday, setPopToday] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/streak", { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as StreakPayload;
      setData(next);
      if (next.todayDone && readSeen() !== next.today) {
        setPopToday(true);
        writeSeen(next.today);
      }
    } catch {
      // nätverksfel: raden visas helt enkelt inte
    }
  }, []);

  useEffect(() => {
    void load();
    return onStreakEvent(() => void load());
  }, [load]);

  if (!data) {
    return <div className={cn("h-[58px] animate-pulse rounded-2xl border border-surface-border bg-surface-overlay/30", className)} />;
  }

  const letters = t("dayLetters").split(",");
  const todayIndex = data.week.findIndex((d) => d.isToday);
  const left = 7 - data.daysThisWeek;
  const boosted = data.nextReward.grades > (data.isPro ? 2 : 1);
  const status = data.daysThisWeek === 7 ? t("weekDone") : !data.weekStillPossible ? t("weekMissed") : t("daysLeft", { count: left });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t("title")}: ${data.dayStreak} ${t("daysLabel", { count: data.dayStreak })}`}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-2xl border border-surface-border px-3 py-2 text-left transition-transform active:scale-[0.99]",
          data.todayDone ? "bg-holo-cyan/[0.06]" : "bg-transparent",
          className
        )}
      >
        <StreakFlame size={30} active={data.todayDone} animated glow={data.todayDone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span
              className={cn(
                "font-display text-xl font-black leading-none tabular-nums",
                data.todayDone ? "text-holo-cyan" : "text-ink-muted"
              )}
            >
              {data.dayStreak}
            </span>
            <span className="truncate text-xs font-bold text-ink">{t("daysLabel", { count: data.dayStreak })}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-ink-faint">{t("weeksInRow", { count: data.weekStreak })}</p>
        </div>
        <div className="shrink-0">
          <StreakWeekRow
            days={data.week}
            letters={letters}
            todayLabel={t("today")}
            popIndex={popToday ? todayIndex : -1}
            size={19}
            popDelayMs={150}
            compact
          />
        </div>
      </button>

      <BottomSheet open={open} title={t("title")} onClose={() => setOpen(false)} closeLabel={t("close")}>
        <div className="space-y-5 pb-4">
          <div className="flex items-center gap-3">
            <StreakFlame size={56} active={data.todayDone} animated glow={data.todayDone} />
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className={cn("font-display text-3xl font-black leading-none tabular-nums", data.todayDone ? "text-holo-cyan" : "text-ink-muted")}>
                  {data.dayStreak}
                </span>
                <span className="text-sm font-bold text-ink">{t("daysLabel", { count: data.dayStreak })}</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-ink-faint">{t("weeksInRow", { count: data.weekStreak })}</p>
            </div>
          </div>

          <div className="max-w-sm">
            <StreakWeekRow days={data.week} letters={letters} todayLabel={t("today")} size={34} />
          </div>

          <div>
            <p className="text-sm font-semibold text-ink">{data.todayDone ? t("todayDone") : t("todayTodo")}</p>
            <p className="mt-0.5 text-xs text-ink-faint">{status}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {data.nextReward.scans > 0 && <Chip tone="scan">{t("rewardScans", { count: data.nextReward.scans })}</Chip>}
            <Chip tone="grade">{t("rewardGrades", { count: data.nextReward.grades })}</Chip>
            <Chip tone="boost">{boosted ? t("boostActive") : `${t("boost")} ${t("boostLabel")}`}</Chip>
          </div>

          <div className="space-y-3 border-t border-surface-border pt-4 text-sm leading-relaxed text-ink-muted">
            <p className="font-display text-base font-bold text-ink">{t("howTitle")}</p>
            <p>{t("howDay")}</p>
            <p>{t("howWeek")}</p>
            <p className="font-semibold text-ink">{data.isPro ? t("howRewardPro") : t("howRewardFree")}</p>
            <p>{t("howBoost")}</p>
            <p>{t("howMiss")}</p>
            <p className="text-xs text-ink-faint">{t("howTime")}</p>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

function Chip({ tone, children }: { tone: "scan" | "grade" | "boost"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-bold",
        tone === "scan" && "bg-holo-cyan/15 text-holo-cyan",
        tone === "grade" && "bg-holo-violet/15 text-holo-violet",
        tone === "boost" && "bg-surface-overlay text-ink"
      )}
    >
      {children}
    </span>
  );
}
