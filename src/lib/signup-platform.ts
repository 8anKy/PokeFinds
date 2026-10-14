/**
 * VAR KONTOT SKAPADES — iOS-appen, Android-appen eller webben (2026-10-14, ägaren ville se Android).
 * Sätts EN gång vid skapandet (`User.signupPlatform`), ren och testad.
 *
 * Signalerna, starkast först:
 *   1. Enhets-id:t (`x-foilio-device`, lib/guest-device.ts): `and-…` = Android, UUID = iOS. Skickas bara
 *      av skannern, så vid registreringen saknas det oftast.
 *   2. Appens UA-tagg `FoilioApp/` (från 1.2, capacitor.config.ts): WebView-UA:n bär "Android" på Android.
 *   3. Annars webben.
 * ⛔ Äldre appbyggen (< 1.2) saknar taggen och räknas som webb — de är nästan borta.
 */
export type SignupPlatform = "ios" | "android" | "web";

export function signupPlatformFrom(userAgent: string | null | undefined, deviceId?: string | null): SignupPlatform {
  if (deviceId) return deviceId.toLowerCase().startsWith("and-") ? "android" : "ios";
  const ua = userAgent ?? "";
  if (ua.includes("FoilioApp/")) return /android/i.test(ua) ? "android" : "ios";
  return "web";
}
