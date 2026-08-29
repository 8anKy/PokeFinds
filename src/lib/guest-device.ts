/**
 * Gästskanning — kortskannern utan konto i APPEN (ägarbeslut 2026-08-29).
 *
 * Identiteten är ett slump-id klienten håller i iOS Keychain respektive
 * Androids ANDROID_ID (`src/lib/device-id.ts`) — båda överlever avinstallation,
 * så "radera appen och installera igen" ger inte nya gratis skanningar. Det
 * skickas som header `x-foilio-device`. Webben har ingen sådan identitet och
 * kräver konto som förut.
 *
 * KVOTMODELLEN (rena funktioner här, DB i services/scanner/guest-device.ts):
 *   gäst    10 skanningar LIVSTID per enhet (`GUEST_SCAN_LIMIT`)
 *   konto   30 i månaden som förut — men "använt" = max(kontots, enhetens
 *           månadsräknare). Gästens 10 räknas alltså in i den första månadens
 *           30 ("20 till"), och "radera kontot, skapa nytt" på samma telefon
 *           ger ingen ny kvot den månaden. Nästa månad nollas båda, som för
 *           alla konton.
 *
 * ⛔ Ett påhittat id ger 10 gratis skanningar — det är samma exponering som ett
 * slängkonto ger i dag, inte mer. Nya enhetsrader är IP-bromsade i tjänsten.
 */

export const GUEST_SCAN_LIMIT = 10;

export const DEVICE_HEADER = "x-foilio-device";

/** UUID v4 (iOS, egen) eller `and-<16 hex>` (ANDROID_ID). Aldrig fri text. */
const DEVICE_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|and-[0-9a-f]{8,32})$/i;

/** Enhets-id ur headern, eller null när den saknas eller inte ser ut som vår. */
export function readDeviceId(headers: Headers): string | null {
  const raw = headers.get(DEVICE_HEADER)?.trim().toLowerCase();
  if (!raw || raw.length > 64) return null;
  return DEVICE_ID_RE.test(raw) ? raw : null;
}

/** UTC-månadsnyckel "2026-08" — samma gräns som kontokvotens startOfMonthUtc(). */
export function monthKeyOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Enhetens månadsräknare, nollad om raden är från en annan månad. */
export function deviceMonthScans(
  row: { monthKey: string | null; monthScans: number } | null,
  now: Date
): number {
  if (!row || row.monthKey !== monthKeyOf(now)) return 0;
  return row.monthScans;
}

/**
 * Kontots "använt" när en enhet är känd: den av de två räknarna som är högst.
 * ⛔ Aldrig summan — en inloggad skanning på enheten räknas på BÅDA sidor.
 */
export function mergedMonthUsed(accountUsed: number, deviceMonthUsed: number): number {
  return Math.max(accountUsed, deviceMonthUsed);
}

export interface GuestQuota {
  used: number;
  limit: number;
  remaining: number;
}

export function guestQuotaOf(guestScans: number): GuestQuota {
  const used = Math.max(0, guestScans);
  return { used, limit: GUEST_SCAN_LIMIT, remaining: Math.max(0, GUEST_SCAN_LIMIT - used) };
}
