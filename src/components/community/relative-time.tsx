import { useLocale } from "next-intl";

/**
 * Relativ tid som följer SPRÅKET ("för 5 minuter sedan" / "5 minutes ago").
 * `formatRelative` i lib/format är svensk rakt igenom; forumet är tvåspråkigt.
 * Ren funktion + tunn komponent så den funkar i både server- och klientträd.
 */
export function relativeLabel(iso: string, locale: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.trunc(diffSec / 86_400), "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(then));
}

export function RelativeTime({ date, className }: { date: string; className?: string }) {
  const locale = useLocale();
  return (
    // suppressHydrationWarning: ISR-HTML:en kan vara några minuter gammal, så
    // texten skiljer sig legitimt mellan server och klient. Sekunderna är inte
    // värda en hydreringsvarning.
    <time dateTime={date} className={className} suppressHydrationWarning>
      {relativeLabel(date, locale)}
    </time>
  );
}
