"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { reportIsFresh, type StoreObservation } from "@/lib/community-stores";
import type { StoreReportDto } from "@/services/community";
import { RelativeTime } from "./relative-time";

export function StoreReportSummary({ report, linked = true }: { report: StoreReportDto; linked?: boolean }) {
  const t = useTranslations("LocalStores");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    // Bara visningen åldras. Ingen timer frågar Neon eller skriver "utgången".
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const fresh = now !== null && reportIsFresh(report.observedAt, now);
  return (
    <div className="space-y-1 rounded-xl border border-surface-border p-3 text-sm">
      <p className={fresh ? "font-medium text-holo-cyan" : "font-medium text-ink-muted"}>
        {now === null || fresh ? t(`observation.${report.observation as StoreObservation}`) : t("oldReport")}
      </p>
      <p className="font-medium text-ink">{report.productLabel}</p>
      <p className="text-ink-muted">{report.store.name} · {report.store.city}</p>
      <p className="text-xs text-ink-muted">{t("observed")} <RelativeTime date={report.observedAt} /></p>
      {!fresh && now !== null && <p className="text-xs text-ink-muted">{t("previousObservation", { status: t(`observation.${report.observation as StoreObservation}`) })}</p>}
      <p className="text-xs text-ink-faint">{report.nearbyAtSubmit ? t("nearbySignal") : t("memberReport")}</p>
      {linked && <Link className="inline-block py-2 text-holo-cyan" href={`/forum?store=${encodeURIComponent(report.store.id)}&view=nearby&status=1`}>{t("storeReports")}</Link>}
    </div>
  );
}
