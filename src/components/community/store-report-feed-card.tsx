"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { reportIsFresh, type StoreObservation } from "@/lib/community-stores";
import { IconChevronRight, IconMapPin } from "@/components/ui/icons";
import type { StoreReportDto } from "@/services/community";
import { RelativeTime } from "./relative-time";

/**
 * Butiksrapporten i bildflödet (ägarbeslut 2026-10-05): status, produkt och pris på
 * ett ögonkast, butiken som EN tryckbar rad. Kompakta listan och tråden använder
 * fortfarande `StoreReportSummary`.
 */
export function StoreReportFeedCard({ report }: { report: StoreReportDto }) {
  const t = useTranslations("LocalStores");
  // Färskheten läses efter mount — servern och klienten ska rendera samma HTML.
  const [fresh, setFresh] = useState<boolean | null>(null);
  useEffect(() => {
    setFresh(reportIsFresh(report.observedAt));
    const timer = setInterval(() => setFresh(reportIsFresh(report.observedAt)), 60_000);
    return () => clearInterval(timer);
  }, [report.observedAt]);
  const observation = report.observation as StoreObservation;
  const stale = fresh === false;
  const tone = stale
    ? "bg-surface-overlay text-ink-muted"
    : observation === "SEEN"
      ? "bg-rise/15 text-rise"
      : observation === "SOLD_OUT"
        ? "bg-fall/15 text-fall"
        : "bg-surface-overlay text-ink-muted";
  const image = report.productImageUrl;
  const storeHref = `/forum?store=${encodeURIComponent(report.store.id)}&view=nearby&status=1`;

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-border">
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span className="truncate">{stale ? t("oldReport") : t(`observation.${observation}`)}</span>
        </span>
        <span className="shrink-0 text-xs text-ink-faint"><RelativeTime date={report.observedAt} /></span>
      </div>

      <div className="flex items-center gap-3 p-3.5">
        {image && (
          <img src={image} alt="" loading="lazy" decoding="async"
            // En trasig katalogbild ska inte lämna en tom ruta i kortet.
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            className="h-20 w-20 shrink-0 rounded-xl bg-surface-overlay object-contain p-1.5" />
        )}
        <div className="min-w-0 flex-1">
          {report.productSlug
            ? <Link href={`/produkter/${report.productSlug}`} className="line-clamp-2 font-semibold leading-snug text-ink">{report.productLabel}</Link>
            : <p className="line-clamp-2 font-semibold leading-snug text-ink">{report.productLabel}</p>}
          {report.priceOre != null && (
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-display text-2xl font-bold tabular-nums text-ink">{formatPrice(report.priceOre, report.currency)}</span>
              <span className="text-xs text-ink-faint">{t("priceInStore")}</span>
            </p>
          )}
        </div>
      </div>

      <Link href={storeHref} className="flex min-h-12 items-center gap-2 border-t border-surface-border px-3.5 text-sm transition-colors hover:bg-surface-overlay/50">
        <IconMapPin size={16} className="shrink-0 text-holo-cyan" aria-hidden="true" />
        <span className="min-w-0 truncate"><span className="font-medium text-ink">{report.store.name}</span><span className="text-ink-muted"> · {report.store.city}</span></span>
        <span className="ml-auto inline-flex shrink-0 items-center text-xs font-medium text-holo-cyan">{t("storeReports")}<IconChevronRight size={16} aria-hidden="true" /></span>
      </Link>
      <p className="border-t border-surface-border px-3.5 py-2 text-[11px] text-ink-faint">
        {report.nearbyAtSubmit ? t("nearbySignal") : t("memberReport")}
      </p>
    </div>
  );
}
