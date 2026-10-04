/**
 * "HJÄLP TILL ATT FÖRBÄTTRA SKANNERN" (ägarbeslut 2026-10-04) — FRIVILLIGT samtycke
 * till att skanningsbilden sparas, så att skannerns bildmatchning kan mätas och
 * förbättras mot riktiga fångster (samma `scanner-facit/`-väg som admins skanningar,
 * scripts/scanner-photo-export.ts).
 *
 * ⛔ AV SOM STANDARD. Policyn lovade länge att skanningsbilder aldrig sparas; bara
 *    den som själv slår på reglaget omfattas (art. 6.1 a GDPR — samtycke).
 * ⛔ Samtycket är en TIDSSTÄMPEL i `User.preferences`, satt av servern
 *    (PATCH /api/users/me, `scanPhotoConsent`) — aldrig av klientens fria
 *    preferences-objekt. Avstängt ⇒ redan sparade bilder raderas.
 */
export const SCAN_PHOTO_CONSENT_KEY = "scanPhotoConsentAt";

export function scanPhotoConsent(preferences: unknown): boolean {
  if (!preferences || typeof preferences !== "object") return false;
  const v = (preferences as Record<string, unknown>)[SCAN_PHOTO_CONSENT_KEY];
  return typeof v === "string" && v.length > 0;
}
