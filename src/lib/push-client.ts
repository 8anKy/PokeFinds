"use client";
/**
 * Klient-sida native push (iOS/APNs). Använder native-bryggan window.Capacitor för
 * plattformsdetektion (den bundlade @capacitor/core-importen gav undefined i
 * WebView:n) + npm-paketets PushNotifications för korrekt event-routing. No-ops på
 * web. Enhetstoken POST:as till /api/push/subscribe.
 *
 * VIKTIGT (native-bygget): AppDelegate måste posta
 * .capacitorDidRegisterForRemoteNotifications — annars ger register() varken token
 * eller fel (default-AppDelegaten gör det inte; codemagic.yaml injicerar metoderna).
 * Och APNs-nyckeln (.p8) måste täcka PRODUKTION (TestFlight = produktions-APNs);
 * en Sandbox-scopad nyckel ger 403 BadEnvironmentKeyInToken.
 */
import { apiFetch } from "@/lib/client-api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = { isNativePlatform: () => boolean; getPlatform: () => string; Plugins?: { PushNotifications?: any } };

function bridge(): Bridge | null {
  const cap = (globalThis as { Capacitor?: Bridge }).Capacitor;
  return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform() ? cap : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPushPlugin(): Promise<{ PushNotifications: any; platform: string } | null> {
  const cap = bridge();
  if (!cap) return null;
  // npm-paketets PushNotifications (registerPlugin → korrekt event-routing). Bara
  // @capacitor/core-importen var trasig; push-paketet funkar. Interop-tålig destructure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PushNotifications: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@capacitor/push-notifications");
    PushNotifications = mod.PushNotifications ?? mod.default?.PushNotifications;
  } catch {
    /* paketet ej tillgängligt → bryggan nedan */
  }
  if (!PushNotifications) PushNotifications = cap.Plugins?.PushNotifications;
  if (!PushNotifications) return null;
  return { PushNotifications, platform: cap.getPlatform() };
}

let registrationWired = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wireRegistration(PushNotifications: any, platform: string) {
  if (registrationWired) return;
  registrationWired = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registration", (token: any) => {
    void apiFetch("/api/push/subscribe", {
      method: "POST",
      body: { token: token.value, platform },
    }).catch(() => {});
  });
  // APNs-registrering kan misslyckas asynkront (t.ex. fel nyckel-miljö) → rapportera
  // felet så det går att felsöka (lagras i User.lastPushError server-sida).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registrationError", (err: any) => {
    void apiFetch("/api/push/subscribe", {
      method: "POST",
      body: { error: `registrationError: ${JSON.stringify(err)}` },
    }).catch(() => {});
  });
}

/**
 * Slår på push: be om tillstånd + registrera. Returnerar {ok:false, reason} så UI:t
 * kan visa varför det misslyckades (ej native / behörighet nekad / plugin saknas).
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const p = await getPushPlugin();
    if (!p) return { ok: false, reason: "ej native eller plugin saknas i bygget" };
    await wireRegistration(p.PushNotifications, p.platform);
    const perm = await p.PushNotifications.requestPermissions();
    if (perm?.receive !== "granted") return { ok: false, reason: `behörighet: ${perm?.receive}` };
    await p.PushNotifications.register();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Tyst om-registrering vid app-start om tillstånd redan givet (fångar roterade tokens). */
export async function refreshPush(): Promise<void> {
  try {
    const p = await getPushPlugin();
    if (!p) return;
    await wireRegistration(p.PushNotifications, p.platform);
    const perm = await p.PushNotifications.checkPermissions();
    if (perm?.receive === "granted") await p.PushNotifications.register();
  } catch {
    /* tyst — bästa-ansträngning vid start */
  }
}
