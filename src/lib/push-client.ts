"use client";
/**
 * Klient-sida native push (iOS/APNs, Android/FCM från versionCode 6). Använder native-bryggan window.Capacitor för
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
import { hasAuthHint } from "@/lib/auth-hint";

// Bakgrunds-POST som ALDRIG hård-redirectar vid 401. apiFetch:s 401-hantering gör
// window.location.href = /logga-in → på inloggningssidan blev det en OÄNDLIG
// reload-loop (token-sync → 401 → reload → token-sync → 401 → ...). Token-sync är
// best-effort → tyst miss när man är utloggad.
function postPush(body: Record<string, unknown>): void {
  void fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = { isNativePlatform: () => boolean; getPlatform: () => string; Plugins?: { PushNotifications?: any } };

function bridge(): Bridge | null {
  const cap = (globalThis as { Capacitor?: Bridge }).Capacitor;
  return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform() ? cap : null;
}

/** Första Android-bygget med Firebase (android/app/build.gradle). */
export const ANDROID_FIREBASE_MIN_BUILD = 6;

let androidFirebase: Promise<boolean> | undefined;
function androidHasFirebase(): Promise<boolean> {
  androidFirebase ??= (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      return Number(info.build) >= ANDROID_FIREBASE_MIN_BUILD;
    } catch {
      return false; // vet vi inte ⇒ ingen push hellre än en krasch
    }
  })();
  return androidFirebase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPushPlugin(): Promise<{ PushNotifications: any; platform: string } | null> {
  const cap = bridge();
  if (!cap) return null;
  // ⛔ Android: bara byggen MED Firebase (google-services.json, versionCode ≥ 6, 2026-10-17).
  // I äldre byggen kastar PushNotifications.register() "Default FirebaseApp is not
  // initialized" som en NATIV, ofångbar exception — hela appen kraschar. Versionskoden
  // kommer ur det installerade bygget (App.getInfo), aldrig ur UA:n, som lokala
  // Android-byggen inte versionsmärker.
  if (cap.getPlatform() === "android" && !(await androidHasFirebase())) return null;
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
  // Android: larmen går i en egen kanal med hög prioritet (heads-up + ljud). Samma id som
  // servern skickar (ANDROID_CHANNEL_ID i lib/fcm.ts). Idempotent — finns den redan rörs den inte.
  if (platform === "android") {
    await PushNotifications.createChannel({
      id: "alerts",
      name: "Larm",
      description: "Restock- och prislarm, meddelanden",
      importance: 5,
      visibility: 1,
      sound: "default",
    }).catch(() => undefined);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registration", (token: any) => {
    postPush({ token: token.value, platform });
  });
  // APNs-registrering kan misslyckas asynkront (t.ex. fel nyckel-miljö) → rapportera
  // felet så det går att felsöka (lagras i User.lastPushError server-sida).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registrationError", (err: any) => {
    postPush({ error: `registrationError: ${JSON.stringify(err)}` });
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
    // Bara för inloggade — token hör till en användare. Utloggad → hoppa över
    // (annars 401 på token-POSTen, helt onödigt).
    if (!hasAuthHint()) return;
    const p = await getPushPlugin();
    if (!p) return;
    await wireRegistration(p.PushNotifications, p.platform);
    const perm = await p.PushNotifications.checkPermissions();
    if (perm?.receive === "granted") await p.PushNotifications.register();
  } catch {
    /* tyst — bästa-ansträngning vid start */
  }
}
