"use client";

import { DEVICE_HEADER } from "@/lib/guest-device";

/**
 * Enhetsidentitet för gästskanning — BARA i appen.
 *
 * iOS: ett UUID vi själva slumpar vid första start och lägger i KEYCHAIN
 * (`@aparajita/capacitor-secure-storage`). Keychain-poster överlever
 * avinstallation — det är hela poängen: "radera appen, installera igen" ger
 * samma id och därmed samma räknare. (`identifierForVendor` nollas vid
 * ominstallation och duger inte.) Raderas först vid "Radera allt innehåll".
 * Android: ANDROID_ID via `@capacitor/device` — stabilt per app-signatur och
 * användare över ominstallationer, till fabriksåterställning.
 * Webb: null — ingen tillförlitlig identitet, kontot krävs som förut.
 *
 * Servern validerar formen (src/lib/guest-device.ts). Värdet är inte hemligt.
 */

const KEY = "foilio-device-id";
let cached: Promise<string | null> | null = null;

async function resolve(): Promise<string | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    // ⛔ RÖR ALDRIG ETT PLUGIN SOM INTE FINNS I BYGGET. Appbygge 40 (utan de
    // här pluginen) HÄNGDE hela WebView:en när SecureStorage anropades — svart
    // sida, tabbarna svarade inte, kameran startade aldrig (2026-08-29). Ett
    // äldre bygge ska bete sig exakt som före gästskanningen: inget id ⇒ ingen
    // gäst, inloggade skannar som vanligt.
    if (Capacitor.getPlatform() === "android") {
      if (!Capacitor.isPluginAvailable("Device")) return null;
      const { Device } = await import("@capacitor/device");
      const { identifier } = await Device.getId();
      const hex = identifier?.toLowerCase().replace(/[^0-9a-f]/g, "") ?? "";
      return hex.length >= 8 ? `and-${hex.slice(0, 32)}` : null;
    }
    if (!Capacitor.isPluginAvailable("SecureStorage")) return null;
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    const existing = (await SecureStorage.get(KEY, false, false)) as string | null;
    if (typeof existing === "string" && existing.length >= 20) return existing;
    const fresh = crypto.randomUUID();
    await SecureStorage.set(KEY, fresh, false, false);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * ⛔ FÅR ALDRIG BLOCKERA. I ett appbygge där pluginet inte är inkompilerat
 * (bygge 40, 2026-08-29) resolvade `SecureStorage.get` aldrig — skannern stod
 * svart för utloggade och fastnade på "Startar kameran…" för inloggade, för
 * båda väntade på id:t. Hård tidsgräns: inget id inom 2,5 s ⇒ null, dvs
 * "ingen gästidentitet" — inloggade skannar som förut, utloggade skickas
 * till inloggningen.
 */
const TIMEOUT_MS = 2500;

export function getDeviceId(): Promise<string | null> {
  if (!cached) {
    cached = Promise.race([
      resolve(),
      new Promise<string | null>((r) => setTimeout(() => r(null), TIMEOUT_MS)),
    ]);
  }
  return cached;
}

/** Headers att lägga på skanner-anrop: enhets-id när appen har ett. */
export async function deviceHeaders(): Promise<Record<string, string>> {
  const id = await getDeviceId();
  return id ? { [DEVICE_HEADER]: id } : {};
}
