/**
 * GRATISKONTOTS RESTOCK-LARM (ägarbeslut 2026-09-15).
 *
 * Bakgrunden: många nya konton, en betalande. Ett gratiskonto fick tidigare
 * INGENTING av Bevaka-knappen — produkten sparades, larmet avfyrades aldrig — så
 * ingen lärde sig vad Pro faktiskt är. Nu ingår ETT restock-larm i gratis, men det
 * levereras NÅGRA MINUTER EFTER Pro och säger det själv ("Pro-medlemmar fick det
 * här för 4 min sedan"). Restocks tar slut på minuter, så skillnaden känns i samma
 * ögonblick larmet kommer — och skälet att uppgradera står i notisen. Det andra
 * larmet man försöker slå på öppnar paywall-arket.
 *
 * ⛔ FÖRDRÖJNINGEN ÄR EN KONSTANT, INTE EN ENV. Talet står i copyn ("4 min efter
 *    Pro" i spec-bladet och arken) och `tests/unit/free-restock-alert.test.ts`
 *    vaktar att de är samma tal — en env hade låtit dem glida isär tyst.
 *
 * ⛔ 4 MINUTER ÄR ETT KOSTNADSVAL, INTE EN SMAKSAK. Fördröjda larm skickas av en
 *    timer i restock-hit-rutten som fyrar `delay + 15 s` efter hiten. Neons
 *    autosuspend är 300 s efter senaste fråga, så vid 4 min är databasen fortfarande
 *    vaken och den andra utskicksrundan kostar NOLL väckningar. Vid 10 min hade
 *    varje hit-fönster köpt en extra väckning (≈ 12/dygn ≈ 1 h ≈ $1/mån vid
 *    0,25 CU). Höjs talet över ~4,5 min måste den kalkylen göras om.
 *
 * ⛔ "DET ENA LARMET" = det ÄLDSTA bevakningsobjektet med restockAlert på. Regeln
 *    dömer på två ställen med samma helper: vid SKRIVNING (ett andra larm nekas
 *    med kod FREE_RESTOCK_ALERT_LIMIT) och vid LARMTILLFÄLLET (en användare kan ha
 *    varit Pro när raderna skapades och fallit till Free sedan — RevenueCat
 *    EXPIRATION — och då är bara det äldsta kvar). Samma försvar-i-djupet som
 *    set-bevakningens mottagarfråga.
 */

export const FREE_RESTOCK_ALERT_LIMIT = 1;

/** Minuter efter Pro som gratiskontots restock-larm levereras. Står i copyn. */
export const FREE_RESTOCK_ALERT_DELAY_MINUTES = 4;

export const FREE_RESTOCK_ALERT_DELAY_MS = FREE_RESTOCK_ALERT_DELAY_MINUTES * 60_000;

/** Felkoden klienten reagerar på (öppnar paywall-arket) — aldrig på texten. */
export const FREE_RESTOCK_ALERT_LIMIT_CODE = "FREE_RESTOCK_ALERT_LIMIT";

/**
 * Tidigast-tidpunkt för ett gratiskontos larm skapat `now`.
 */
export function freeRestockAlertNotBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() + FREE_RESTOCK_ALERT_DELAY_MS);
}

/**
 * Hur många minuter EFTER Pro larmet gick ut — raden i notisen. null när larmet
 * inte var fördröjt (Pro, prislarm, äldre rader). Avrundas till hela minuter
 * och aldrig under 1: "för 0 min sedan" är ingen mening.
 */
export function freeDelayMinutes(alert: { triggeredAt: Date; notBefore: Date | null }): number | null {
  if (!alert.notBefore) return null;
  const ms = alert.notBefore.getTime() - alert.triggeredAt.getTime();
  if (!(ms > 0)) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * Prisma-villkoret "larmet får skickas nu": ingen tidpunkt, eller en som passerat.
 * Skrivs som ett OR-fragment att spreada in i where-objektet.
 */
export function alertDueWhere(now: Date = new Date()): { OR: Array<{ notBefore: null } | { notBefore: { lte: Date } }> } {
  return { OR: [{ notBefore: null }, { notBefore: { lte: now } }] };
}

export interface RestockAlertRow {
  userId: string;
  productId: string;
  createdAt: Date;
}

/**
 * Vilket objekt som är gratiskontots ENDA restock-larm, per användare: det äldsta
 * med restockAlert på. Ordningen på `rows` spelar ingen roll.
 */
export function pickFreeRestockAlertItems(rows: RestockAlertRow[]): Map<string, string> {
  const pick = new Map<string, RestockAlertRow>();
  for (const r of rows) {
    const cur = pick.get(r.userId);
    if (!cur || r.createdAt.getTime() < cur.createdAt.getTime()) pick.set(r.userId, r);
  }
  const out = new Map<string, string>();
  for (const [userId, r] of pick) out.set(userId, r.productId);
  return out;
}

/**
 * Raden som läggs på notisen/mejlet när larmet var fördröjt. Svenska med flit:
 * larmen (push + mejl) är svenska sedan tidigare — det här är samma yta.
 */
export function freeDelayNotice(minutes: number): string {
  return `Pro-medlemmar fick det här larmet för ${minutes} min sedan — Pro larmar direkt, på allt du bevakar.`;
}
