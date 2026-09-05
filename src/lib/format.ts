/** Priser lagras i öre (integer). Dessa hjälpfunktioner formaterar för UI. */

export function formatPrice(ore: number | null | undefined, currency = "SEK"): string {
  if (ore == null) return "–";
  const kr = ore / 100;
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency,
    minimumFractionDigits: kr % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kr);
}

export function formatPercent(value: number, signed = true): string {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1).replace(".", ",")} %`;
}

/**
 * Språk → Intl-tagg. Utan argument svenska (admin är svensk rakt igenom); med
 * next-intls locale ("sv"/"en") följer datumet gränssnittet — "31 juli 2026" mitt
 * i ett engelskt set-index var en av språkblandningarna i QA-svepet 2026-09-05.
 * Engelska = en-GB (dag före månad, som prisgrafen), aldrig US.
 */
export function dateLocaleTag(locale?: string): string {
  return locale && locale.startsWith("en") ? "en-GB" : "sv-SE";
}

export function formatDate(date: Date | string | null | undefined, locale?: string): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat(dateLocaleTag(locale), { dateStyle: "medium" }).format(
    new Date(date)
  );
}

export function formatDateTime(date: Date | string | null | undefined, locale?: string): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat(dateLocaleTag(locale), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

/**
 * Relativ tid. Utan `locale` (eller med svenska) behålls de korta svenska
 * formerna ("5 min sedan"); för andra språk går det via Intl så att en engelsk
 * sida inte visar "tim sedan" mitt i gränssnittet. Forumet har en egen variant
 * (`relativeLabel` i community/relative-time.tsx) som följer språket rakt av.
 */
export function formatRelative(date: Date | string, locale?: string): string {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const minutes = Math.floor(diff / 60_000);
  if (locale && !locale.startsWith("sv")) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    if (minutes < 1) return rtf.format(0, "second");
    if (minutes < 60) return rtf.format(-minutes, "minute");
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return rtf.format(-hours, "hour");
    const days = Math.floor(hours / 24);
    if (days < 30) return rtf.format(-days, "day");
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));
  }
  if (minutes < 1) return "nyss";
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d sedan`;
  return formatDate(new Date(d));
}

export function priceChangePercent(oldPrice: number, newPrice: number): number {
  if (oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}
