/**
 * TYSTA TIMMAR FÖR PRISLARM (2026-09-28).
 *
 * `cardmarket-refresh` körs på natten sedan 2026-09-28 (priser och samlingsvärde ska
 * vara färska när användarna vaknar), och dess prislarmsvep hade då pushat kl 03–04
 * svensk tid. Ett prislarm är aldrig ett lopp på minuter — ett restock-larm är det,
 * och restock-larmen rörs INTE här. Ett prislarm som skapas under natten får därför
 * `Alert.notBefore` = nästa 07:00 i Stockholm, och skickas av morgonrundan
 * (`/api/cron/alerts-due`, startad av väckarklockan i discord-restock.yml) eller av
 * första utskicket därefter.
 *
 * Svensk tid med sommartid — räknas med Intl, aldrig med en hårdkodad offset.
 */
export const QUIET_TZ = "Europe/Stockholm";
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;

function localParts(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Minuter som zonen ligger före UTC vid `at` (Stockholm: 60 eller 120). */
function offsetMinutes(at: Date, tz: string): number {
  const p = localParts(at, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - at.getTime()) / 60_000);
}

/** UTC-ögonblicket för lokal tid `hour:00` på lokala datumet y-m-d. */
function localTimeToUtc(y: number, m: number, d: number, hour: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  // Två varv: offseten vid gissningen kan skilja sig från den vid svaret runt ett DST-skifte.
  let at = new Date(guess.getTime() - offsetMinutes(guess, tz) * 60_000);
  at = new Date(guess.getTime() - offsetMinutes(at, tz) * 60_000);
  return at;
}

/**
 * null = inte tysta timmar, skicka som vanligt. Annars nästa 07:00 i Stockholm.
 */
export function priceAlertQuietUntil(now: Date = new Date(), tz: string = QUIET_TZ): Date | null {
  const p = localParts(now, tz);
  if (p.h >= QUIET_END_HOUR && p.h < QUIET_START_HOUR) return null;
  if (p.h < QUIET_END_HOUR) return localTimeToUtc(p.y, p.m, p.d, QUIET_END_HOUR, tz);
  // Kväll ⇒ imorgon bitti. Datumaritmetik i UTC på lokala datumet är DST-säker.
  const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return localTimeToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), QUIET_END_HOUR, tz);
}
