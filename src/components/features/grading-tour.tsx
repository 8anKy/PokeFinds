"use client";

/** Graderingsturen — stegen och reglerna i `lib/grading-tour.ts`. */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Spotlight, useTourTarget } from "@/components/features/spotlight";
import { GRADING_TOUR_STEPS, markGradingTourSeen } from "@/lib/grading-tour";

export function GradingTour(props: { open: boolean; onClose: () => void }) {
  const t = useTranslations("GradingTour");
  const [step, setStep] = useState(0);
  const { open, onClose } = props;

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = useCallback(() => {
    markGradingTourSeen();
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (step + 1 >= GRADING_TOUR_STEPS.length) finish();
    else setStep(step + 1);
  }, [step, finish]);

  const current = open ? GRADING_TOUR_STEPS[step] : null;
  const rect = useTourTarget(current?.target ?? null, next);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!current || !rect) return null;
  const last = step === GRADING_TOUR_STEPS.length - 1;

  return (
    <Spotlight rect={rect} blockTarget label={t("label")}>
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-holo-cyan">
        {t("progress", { step: step + 1, total: GRADING_TOUR_STEPS.length })}
      </div>
      <h2 className="mt-1 text-pretty text-base font-bold leading-snug text-ink">{t(`${current.copy}Title`)}</h2>
      <p className="mt-1 text-pretty text-sm leading-relaxed text-ink-muted">{t(`${current.copy}Body`)}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={finish}
          className="min-h-[44px] px-1 text-sm font-medium text-ink-faint transition-colors hover:text-ink"
        >
          {t("skip")}
        </button>
        <button
          type="button"
          onClick={next}
          className="inline-flex min-h-[44px] items-center rounded-xl bg-holo-cyan px-5 text-sm font-semibold text-surface transition-colors hover:bg-holo-cyan/90"
        >
          {last ? t("done") : t("next")}
        </button>
      </div>
    </Spotlight>
  );
}
