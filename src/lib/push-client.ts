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
}

/** Anropas när användaren slår PÅ push: be om tillstånd och registrera enheten. */
export async function enablePush(): Promise<boolean> {
  const p = await getPlugin();
  if (!p) return false;
  await wireRegistration(p.PushNotifications, p.platform);
  const perm = await p.PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return false;
  await p.PushNotifications.register();
  return true;
}

/** Tyst om-registrering vid app-start om tillstånd redan givet (fångar roterade tokens). */
export async function refreshPush(): Promise<void> {
  const p = await getPlugin();
  if (!p) return;
  await wireRegistration(p.PushNotifications, p.platform);
  const perm = await p.PushNotifications.checkPermissions();
  if (perm.receive === "granted") await p.PushNotifications.register();
}
