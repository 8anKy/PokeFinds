"use client";
/**
 * Klient-sida native push (iOS/APNs). Använder den native-injicerade bryggan
 * `window.Capacitor` DIREKT i stället för att importera @capacitor/core — den
 * bundlade importen gav `Capacitor === undefined` i WebView:n (ESM/CJS-interop)
 * vilket kraschade på isNativePlatform. Bryggan finns garanterat i appen.
 * No-ops på web (ingen brygga). Enhetstoken POST:as till /api/push/subscribe.
 */
import { apiFetch } from "@/lib/client-api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Plugins?: { PushNotifications?: any };
};

function bridge(): Bridge | null {
  const cap = (globalThis as { Capacitor?: Bridge }).Capacitor;
  return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform() ? cap : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPushPlugin(): Promise<{ PushNotifications: any; platform: string } | null> {
  const cap = bridge();
  if (!cap) return null;
  // 1) npm-paketets PushNotifications (registerPlugin → korrekt event-routing för
  //    'registration'/'registrationError'; den råa bryggans proxy levererar inte
  //    event). Interop-tålig destructure. Bara @capacitor/core-importen var trasig.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PushNotifications: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@capacitor/push-notifications");
    PushNotifications = mod.PushNotifications ?? mod.default?.PushNotifications;
  } catch {
    /* paketet ej tillgängligt → bryggan nedan */
  }
  // 2) Fallback: native-bryggans proxy (om paketet inte gick att ladda).
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
  // APNs-registrering kan misslyckas asynkront (t.ex. saknad aps-environment-
  // entitlement) → rapportera felet så vi kan se det server-sida.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registrationError", (err: any) => {
    void apiFetch("/api/push/subscribe", {
      method: "POST",
      body: { error: `registrationError: ${JSON.stringify(err)}` },
    }).catch(() => {});
  });
}

/**
 * Anropas när användaren slår PÅ push: be om tillstånd och registrera enheten.
 * Returnerar {ok:false, reason} så UI:t kan visa VARFÖR det misslyckades.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const p = await getPushPlugin();
    if (!p) return { ok: false, reason: "ej native eller plugin saknas i bygget" };
    await wireRegistration(p.PushNotifications, p.platform);
    const perm = await p.PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return { ok: false, reason: `behörighet: ${perm.receive}` };
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
    if (perm.receive === "granted") await p.PushNotifications.register();
  } catch {
    /* tyst — bästa-ansträngning vid start */
  }
}
