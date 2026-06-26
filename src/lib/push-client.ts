"use client";
/**
 * Klient-sida native push (iOS/APNs via @capacitor/push-notifications).
 * Bara i den native appen — på web är Capacitor.isNativePlatform() false och
 * allt blir no-ops. Enhetstoken POST:as till /api/push/subscribe.
 */
import { apiFetch } from "@/lib/client-api";

type PushPlugin = (typeof import("@capacitor/push-notifications"))["PushNotifications"];

async function getPlugin(): Promise<{ PushNotifications: PushPlugin; platform: string } | null> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return { PushNotifications, platform: Capacitor.getPlatform() };
}

let registrationWired = false;
async function wireRegistration(PushNotifications: PushPlugin, platform: string) {
  if (registrationWired) return;
  registrationWired = true;
  await PushNotifications.addListener("registration", (token) => {
    void apiFetch("/api/push/subscribe", {
      method: "POST",
      body: { token: token.value, platform },
    }).catch(() => {});
  });
  // APNs-registrering kan misslyckas asynkront (t.ex. saknad aps-environment-
  // entitlement) → rapportera felet så vi kan se det server-sida.
  await PushNotifications.addListener("registrationError", (err) => {
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
    const p = await getPlugin();
    if (!p) return { ok: false, reason: "ej native (web-läge)" };
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
  const p = await getPlugin();
  if (!p) return;
  await wireRegistration(p.PushNotifications, p.platform);
  const perm = await p.PushNotifications.checkPermissions();
  if (perm.receive === "granted") await p.PushNotifications.register();
}
