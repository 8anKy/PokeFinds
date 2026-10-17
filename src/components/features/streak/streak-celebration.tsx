"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { StreakEvent } from "@/lib/streak";
import { installStreakFetchTap, onStreakEvent } from "@/lib/streak-client";
import { hapticImpact } from "@/lib/haptics";
import { StreakFlame } from "./streak-flame";
import { Sparks, StreakWeekRow } from "./streak-week-row";
import { StreakRewardTile } from "./streak-reward-tile";

/**
 * Firandet efter dagens FÖRSTA handling — helskärm, en gång per dag. Monteras i
 * rot-layouten. Under skanningen väntar den tills användaren lämnat kameran: att
 * få en helskärm mitt i en bunt kort vore att straffa just den handling vi belönar.
 */
export function StreakCelebrationHost() {
  const pathname = usePathname() ?? "";
  const [queue, setQueue] = useState<StreakEvent[]>([]);
  const busy = /\/skanna(\/|$)/.test(pathname);

  useEffect(() => {
    installStreakFetchTap();
    return onStreakEvent((e) => setQueue((q) => [...q, e]));
  }, []);

  const current = !busy ? queue[0] : undefined;
  const close = useCallback(() => setQueue((q) => q.slice(1)), []);

  if (!current || typeof document === "undefined") return null;
  return createPortal(<Celebration key={`${current.dayStreak}-${current.todayIndex}`} event={current} onClose={close} />, document.body);
}

function Celebration({ event, onClose }: { event: StreakEvent; onClose: () => void }) {
  const t = useTranslations("Streak");
  const [stage, setStage] = useState<"day" | "week">("day");
  const [counted, setCounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hapticImpact();
    const a = window.setTimeout(() => setCounted(true), 650);
    const b = window.setTimeout(() => hapticImpact(), 1050);
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const letters = t("dayLetters").split(",");
  const days = event.week.map((done, i) => ({
    done,
    isToday: i === event.todayIndex,
    isFuture: i > event.todayIndex,
  }));
  const left = 7 - event.daysThisWeek;
  const weekPossible = event.week.every((d, i) => d || i >= event.todayIndex);

  const next = () => {
    if (stage === "day" && event.weekCompleted && event.reward) {
      hapticImpact();
      setStage("week");
    } else onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-[90] flex flex-col bg-black"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Varm ljuskägla bakom lågan. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[70%]"
        style={{ background: "radial-gradient(60% 55% at 50% 38%, rgba(45,212,191,0.28) 0%, rgba(45,212,191,0) 70%)" }}
        aria-hidden="true"
      />

      {stage === "day" ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="streak-ignite relative">
            <StreakFlame size={176} animated glow />
            <Sparks delayMs={250} scale={2.4} />
          </div>

          <div className="relative mt-4 h-[96px] w-full overflow-hidden" aria-live="polite">
            {event.dayStreak > 1 && !counted && (
              <span className="absolute inset-0 font-display text-[88px] font-black leading-none text-[#2dd4bf] tabular-nums">
                {event.dayStreak - 1}
              </span>
            )}
            {event.dayStreak > 1 && counted && (
              <span className="streak-count-out absolute inset-0 font-display text-[88px] font-black leading-none text-[#2dd4bf] tabular-nums">
                {event.dayStreak - 1}
              </span>
            )}
            {(counted || event.dayStreak <= 1) && (
              <span className="streak-count-in absolute inset-0 font-display text-[88px] font-black leading-none text-[#2dd4bf] tabular-nums">
                {event.dayStreak}
              </span>
            )}
          </div>
          <p className="streak-rise font-display text-2xl font-extrabold text-ink" style={{ animationDelay: "500ms" }}>
            {event.dayStreak <= 1 ? t("celebrateFirst") : t("celebrateDay", { count: event.dayStreak })}
          </p>

          <div
            className="streak-rise mt-8 w-full max-w-sm rounded-3xl border border-surface-border bg-surface-overlay/40 p-4"
            style={{ animationDelay: "700ms" }}
          >
            <StreakWeekRow days={days} letters={letters} todayLabel={t("today")} popIndex={event.todayIndex} popDelayMs={1000} />
            <p className="mt-4 text-sm font-semibold text-ink-muted">
              {event.weekCompleted
                ? t("weekDone")
                : weekPossible
                  ? t("daysLeft", { count: left })
                  : t("weekMissed")}
            </p>
          </div>
          {!event.weekCompleted && (
            <p className="streak-rise mt-4 text-sm text-ink-faint" style={{ animationDelay: "900ms" }}>
              {t("celebrateKeep")}
            </p>
          )}
        </div>
      ) : (
        <WeekReward event={event} />
      )}

      <div className="relative px-6 pb-6 pt-2">
        <button
          ref={closeRef}
          type="button"
          onClick={next}
          className="streak-button streak-rise mx-auto block h-14 w-full max-w-sm rounded-2xl bg-[#2dd4bf] font-display text-base font-extrabold uppercase tracking-wide text-[#042f2e]"
          style={{ animationDelay: stage === "day" ? "1100ms" : "1300ms" }}
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}

function WeekReward({ event }: { event: StreakEvent }) {
  const t = useTranslations("Streak");
  const reward = event.reward!;
  const nextWeek = event.weekStreak + 1;
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="streak-ignite relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/streak/reward-chest.webp" alt="" width={196} height={196} className="h-[196px] w-[196px] object-contain" />
        <Sparks delayMs={200} scale={3} />
      </div>
      <h2 className="streak-rise mt-2 font-display text-3xl font-black text-ink" style={{ animationDelay: "350ms" }}>
        {t("celebrateWeekTitle")}
      </h2>
      <p className="streak-rise mt-2 max-w-xs text-sm text-ink-muted" style={{ animationDelay: "450ms" }}>
        {t("celebrateWeekText")}
      </p>
      <div className="mt-7 grid w-full max-w-sm grid-cols-2 gap-3">
        {reward.scans > 0 && (
          <StreakRewardTile kind="scan" amount={reward.scans} label={t("scansLabel")} delayMs={650} />
        )}
        {reward.grades > 0 && (
          <StreakRewardTile
            kind="grade"
            amount={reward.grades}
            label={t("gradesLabel")}
            delayMs={850}
            className={reward.scans > 0 ? undefined : "col-span-2"}
          />
        )}
      </div>
      {nextWeek === 4 && (
        <p className="streak-rise mt-5 text-sm font-semibold text-[#5eead4]" style={{ animationDelay: "1100ms" }}>
          {t("celebrateNextBoost", { week: nextWeek })}
        </p>
      )}
    </div>
  );
}
