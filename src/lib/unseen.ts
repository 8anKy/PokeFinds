/**
 * "Något nytt"-pricken på Community och Nyheter (ägarbeslut 2026-10-09).
 *
 * Rena beslut, testade i tests/unit/unseen.test.ts. Klienten minns PER ENHET när
 * sektionen senast öppnades (localStorage) — ingen DB-skrivning, ingen ny
 * personuppgift. Servern (`/api/unseen`) svarar bara med senaste tidsstämpeln.
 *
 * ⛔ Ingen siffra, bara en prick. ⛔ Egna inlägg tänder den aldrig.
 * ⛔ "Sett" sparas i SERVERNS tid (max av nu och senast kända inlägg) — en klocka
 *    som går efter hade annars lämnat pricken tänd efter att man öppnat sidan.
 */
export type UnseenSection = "community" | "news";

export const UNSEEN_SECTIONS: readonly UnseenSection[] = ["community", "news"];

export const UNSEEN_STORAGE_KEYS: Record<UnseenSection, string> = {
  community: "foilio:seen:community:v1",
  news: "foilio:seen:news:v1",
};

/** Hur ofta klienten får fråga servern (appstart/återkomst glesas ut). */
export const UNSEEN_REFRESH_MS = 60_000;

/** Vilken sektion en sökväg tillhör (locale-prefixet `/en` räknas bort). */
export function sectionOf(pathname: string | null | undefined): UnseenSection | null {
  if (!pathname) return null;
  const path = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  const within = (p: string) => path === p || path.startsWith(`${p}/`);
  if (within("/forum") || within("/community")) return "community";
  if (within("/nyheter") || within("/evenemang")) return "news";
  return null;
}

/** Senaste inlägget som INTE är mitt (raderna är nyast först). */
export function latestByOthers(
  rows: { createdAt: Date | string; userId: string }[],
  myId: string | null
): string | null {
  const row = rows.find((r) => r.userId !== myId);
  return row ? new Date(row.createdAt).toISOString() : null;
}

/** Senaste publiceringstiden bland nyheterna, eller null. */
export function latestPublished(items: { publishedAt: string }[]): string | null {
  let best: number | null = null;
  for (const item of items) {
    const at = Date.parse(item.publishedAt);
    if (Number.isFinite(at) && (best === null || at > best)) best = at;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Tänd pricken? Utan sparat "sett" (ny enhet) räknas allt som osett. */
export function hasUnseen(latest: string | null, seenMs: number): boolean {
  if (!latest) return false;
  const at = Date.parse(latest);
  return Number.isFinite(at) && at > seenMs;
}

/** Vad som sparas som "sett" när sektionen öppnas. */
export function nextSeen(nowMs: number, latest: string | null): number {
  const at = latest ? Date.parse(latest) : NaN;
  return Number.isFinite(at) ? Math.max(nowMs, at) : nowMs;
}
