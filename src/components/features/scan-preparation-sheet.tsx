"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { IconAlertTriangle, IconCards, IconCheck, IconScan } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type ScanGuideMode = "single" | "bulk";

/**
 * Första gången skannern öppnas på en enhet pekar en bubbla på informations-
 * knappen tills den trycks. Nyckeln sätts först när knappen faktiskt TRYCKS,
 * aldrig vid visning: bubblan ska komma tillbaka tills tipsen lästs en gång.
 * Fel-säkert: kastar lagringen ⇒ "sett" (visa inte om och om igen).
 */
const GUIDE_NUDGE_KEY = "foilio:scan-guide-nudge:v1";

export function scanGuideNudgeSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_NUDGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markScanGuideNudgeSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_NUDGE_KEY, "1");
  } catch {
    // Privat läge / blockerad lagring — bubblan visas då nästa gång, vilket är ofarligt.
  }
}

const GUIDE_IMAGES = {
  single: {
    good: "/scan-guide/single-good.webp",
    bad: "/scan-guide/single-bad.webp",
  },
  bulk: {
    good: "/scan-guide/bulk-good.webp",
    bad: "/scan-guide/bulk-bad.webp",
  },
} as const;

export function ScanPreparationSheet({
  open,
  initialMode,
  onClose,
}: {
  open: boolean;
  initialMode: ScanGuideMode;
  onClose: () => void;
}) {
  const t = useTranslations("Scanner");
  const [mode, setMode] = useState<ScanGuideMode>(initialMode);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [initialMode, open]);

  const bulk = mode === "bulk";
  const tips = bulk
    ? [t("scanGuideBulkTip1"), t("scanGuideBulkTip2"), t("scanGuideBulkTip3")]
    : [t("scanGuideSingleTip1"), t("scanGuideSingleTip2"), t("scanGuideSingleTip3")];

  return (
    <BottomSheet
      open={open}
      title={bulk ? t("scanGuideBulkTitle") : t("scanGuideSingleTitle")}
      closeLabel={t("close")}
      onClose={onClose}
      elevated
      panelClassName="sm:mx-auto sm:max-w-lg"
      footer={<BottomSheetCta onClick={onClose}>{t("scanGuideReady")}</BottomSheetCta>}
    >
      <div className="pb-2">
        <div
          className="mb-4 grid grid-cols-2 rounded-xl border border-surface-border bg-surface-overlay/40 p-1"
          role="tablist"
          aria-label={t("scanGuideModeLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={!bulk}
            onClick={() => setMode("single")}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              !bulk ? "bg-holo-cyan/15 text-holo-cyan" : "text-ink-muted hover:text-ink"
            )}
          >
            <IconScan size={17} />
            {t("scanGuideSingleTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={bulk}
            onClick={() => setMode("bulk")}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              bulk ? "bg-holo-cyan/15 text-holo-cyan" : "text-ink-muted hover:text-ink"
            )}
          >
            <IconCards size={17} />
            {t("scanGuideBulkTab")}
          </button>
        </div>

        <p className="mb-3 text-sm leading-relaxed text-ink-muted">{t("scanGuideIntro")}</p>

        <div className="grid grid-cols-2 gap-2.5">
          <GuideExample
            tone="good"
            label={t("scanGuideGood")}
            image={GUIDE_IMAGES[mode].good}
            alt={bulk ? t("scanGuideBulkGoodAlt") : t("scanGuideSingleGoodAlt")}
            caption={
              bulk ? t("scanGuideBulkGoodCaption") : t("scanGuideSingleGoodCaption")
            }
          />
          <GuideExample
            tone="bad"
            label={t("scanGuideAvoid")}
            image={GUIDE_IMAGES[mode].bad}
            alt={bulk ? t("scanGuideBulkBadAlt") : t("scanGuideSingleBadAlt")}
            caption={bulk ? t("scanGuideBulkBadCaption") : t("scanGuideSingleBadCaption")}
          />
        </div>

        <div className="mt-4 rounded-xl border border-holo-gold/30 bg-holo-gold/10 p-3">
          <div className="flex items-start gap-2.5">
            <IconAlertTriangle size={18} className="mt-0.5 shrink-0 text-holo-gold" />
            <p className="text-sm font-medium leading-relaxed text-ink">
              {t("scanGuideGlareWarning")}
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2.5">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-muted">
              <IconCheck size={17} className="mt-0.5 shrink-0 text-rise" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>
    </BottomSheet>
  );
}

function GuideExample({
  tone,
  label,
  image,
  alt,
  caption,
}: {
  tone: "good" | "bad";
  label: string;
  image: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border bg-surface-raised",
        tone === "good" ? "border-rise/35" : "border-fall/35"
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-black">
        <Image
          src={image}
          alt={alt}
          fill
          sizes="(max-width: 640px) 46vw, 230px"
          className="object-cover"
        />
        <span
          className={cn(
            "absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-surface shadow-card",
            tone === "good" ? "bg-rise" : "bg-fall"
          )}
        >
          {label}
        </span>
      </div>
      <figcaption className="px-2.5 py-2 text-xs leading-snug text-ink-muted">
        {caption}
      </figcaption>
    </figure>
  );
}
