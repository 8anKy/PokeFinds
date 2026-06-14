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

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}

export function formatRelative(date: Date | string): string {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const minutes = Math.floor(diff / 60_000);
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
