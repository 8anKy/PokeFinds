/**
 * Talen på delningsbilderna (produkt + samling), rena och testade. Ritningen i
 * `lib/share-card.ts` räknar ingenting själv — den får färdiga punkter och texter.
 */
import { formatPercent } from "@/lib/format";
import type { ShareChange, ShareChartPoint } from "@/lib/share-card";

const DAY_MS = 86_400_000;

function dayMs(date: string): number {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime();
}

/**
 * Grafens fönster: de sista `days` dygnen räknat från SERIENS sista punkt (inte från
 * i dag — en serie som slutade i går ska inte se kortare ut). `days` i svaret är
 * fönstrets verkliga längd, så etiketten aldrig lovar 90 dagar för en vecka data.
 */
export function shareChartWindow(
  series: ShareChartPoint[],
  days: number
): { points: ShareChartPoint[]; days: number } {
  const valid = series.filter((p) => p.price > 0);
  if (valid.length === 0) return { points: [], days: 0 };
  const last = dayMs(valid[valid.length - 1].date);
  const points = valid.filter((p) => dayMs(p.date) >= last - days * DAY_MS);
  const span = Math.round((last - dayMs(points[0].date)) / DAY_MS);
  return { points, days: Math.max(1, Math.min(days, span)) };
}

/** Ett färdigt procenttal (t.ex. produktens `change30`) → bildens förändringsrad. */
export function shareChangeFromPercent(percent: number | null | undefined, period: string): ShareChange | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return null;
  return { text: formatPercent(rounded), period, up: rounded > 0 };
}

/**
 * Förändring över de sista `days` dygnen i en serie (samlingens värdekurva) — samma
 * räkning som samlingens hero: sista punkten mot första punkten i fönstret.
 */
export function shareChangeOverDays(series: ShareChartPoint[], days: number, period: string): ShareChange | null {
  const { points } = shareChartWindow(series, days);
  if (points.length < 2) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  if (first <= 0) return null;
  return shareChangeFromPercent(((last - first) / first) * 100, period);
}
