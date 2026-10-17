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
 * Veckoseriens kort överst på Utforska. Renderas bara för inloggade (sidan avgör
 * med sessionen den redan läser). Hämtar sitt tillstånd en
 * gång vid montering och igen när dagens första handling firats — aldrig pollning.
 */
export function StreakCard({ className }: { className?: string }) {
  const t = useTranslations("Streak");
  const [data, setData] = useState<StreakPayload | null>(null);
  const [popToday, setPopToday] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

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
      // nätverksfel: kortet visas helt enkelt inte
    }
  }, []);

  useEffect(() => {
    void load();
    return onStreakEvent(() => void load());
  }, [load]);

  if (!data) {
    return <div className={cn("h-[214px] animate-pulse rounded-3xl border border-surface-border bg-surface-overlay/30", className)} />;
  }

  const letters = t("dayLetters").split(",");
  const todayIndex = data.week.findIndex((d) => d.isToday);
  const left = 7 - data.daysThisWeek;
  const boosted = data.nextReward.grades > (data.isPro ? 2 : 1);
  const status = data.daysThisWeek === 7 ? t("weekDone") : !data.weekStillPossible ? t("weekMissed") : t("daysLeft", { count: left });

  return (
    <section
      className={cn("relative overflow-hidden rounded-3xl border border-surface-border p-4", className)}
      style={{ background: "linear-gradient(180deg, rgba(255,122,0,0.10) 0%, rgba(0,0,0,0) 55%)" }}
      aria-label={t("title")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <StreakFlame size={48} active={data.todayDone} animated glow={data.todayDone} />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "font-display text-[32px] font-black leading-none tabular-nums",
                  data.todayDone ? "text-[#ff8a00]" : "text-ink-muted"
                )}
              >
                {data.dayStreak}
              </span>
              <span className="text-sm font-bold text-ink">{t("daysLabel", { count: data.dayStreak })}</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-ink-faint">{t("weeksInRow", { count: data.weekStreak })}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHowOpen(true)}
          className="rounded-full border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-muted active:scale-95"
        >
          {t("howItWorks")}
        </button>
      </div>

      <div className="mt-4">
        <StreakWeekRow
          days={data.week}
          letters={letters}
          todayLabel={t("today")}
          popIndex={popToday ? todayIndex : -1}
          size={34}
          popDelayMs={150}
        />
      </div>

      <p className="mt-4 text-sm font-semibold text-ink">{data.todayDone ? t("todayDone") : t("todayTodo")}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{status}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {data.nextReward.scans > 0 && <Chip tone="scan">{t("rewardScans", { count: data.nextReward.scans })}</Chip>}
        <Chip tone="grade">{t("rewardGrades", { count: data.nextReward.grades })}</Chip>
        <Chip tone="boost">{boosted ? t("boostActive") : `${t("boost")} ${t("boostLabel")}`}</Chip>
      </div>

      <BottomSheet open={howOpen} title={t("howTitle")} onClose={() => setHowOpen(false)} closeLabel={t("close")}>
        <div className="space-y-4 pb-4 text-sm leading-relaxed text-ink-muted">
          <div className="flex justify-center py-2">
            <StreakFlame size={72} animated glow />
          </div>
          <p>{t("howDay")}</p>
          <p>{t("howWeek")}</p>
          <p className="font-semibold text-ink">{data.isPro ? t("howRewardPro") : t("howRewardFree")}</p>
          <p>{t("howBoost")}</p>
          <p>{t("howMiss")}</p>
          <p className="text-xs text-ink-faint">{t("howTime")}</p>
        </div>
      </BottomSheet>
    </section>
  );
}

function Chip({ tone, children }: { tone: "scan" | "grade" | "boost"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-bold",
        tone === "scan" && "bg-holo-cyan/15 text-holo-cyan",
        tone === "grade" && "bg-holo-violet/15 text-holo-violet",
        tone === "boost" && "bg-[#ff8a00]/15 text-[#ffb347]"
      )}
    >
      {children}
    </span>
  );
}
