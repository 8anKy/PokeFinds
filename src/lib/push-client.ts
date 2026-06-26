"use client";
/**
 * Klient-sida native push (iOS/APNs). Använder native-bryggan window.Capacitor
 * för plattformsdetektion (den bundlade @capacitor/core-importen gav undefined).
 * Instrumenterad: rapporterar ett diagnos-spår till /api/push/subscribe (lagras
 * som notificationSettings._pushError) så vi kan se exakt var det fastnar.
 * No-ops på web. Enhetstoken POST:as till /api/push/subscribe.
 */
import { apiFetch } from "@/lib/client-api";

// Bumpa vid varje push-deploy → syns i _pushError så vi vet vilken JS enheten kör.
const PUSH_CLIENT_VERSION = "v4";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = { isNativePlatform: () => boolean; getPlatform: () => string; Plugins?: { PushNotifications?: any } };

function bridge(): Bridge | null {
  const cap = (globalThis as { Capacitor?: Bridge }).Capacitor;
  return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform() ? cap : null;
}

function report(msg: string) {
  void apiFetch("/api/push/subscribe", {
    method: "POST",
    body: { error: `[${PUSH_CLIENT_VERSION}] ${msg}` },
  }).catch(() => {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePlugin(): Promise<{ PushNotifications: any; platform: string; source: string } | null> {
  const cap = bridge();
  if (!cap) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PushNotifications: any;
  let source = "none";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@capacitor/push-notifications");
    if (mod.PushNotifications) { PushNotifications = mod.PushNotifications; source = "pkg.named"; }
    else if (mod.default?.PushNotifications) { PushNotifications = mod.default.PushNotifications; source = "pkg.default"; }
  } catch (e) {
    source = `pkg.import-error: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!PushNotifications && cap.Plugins?.PushNotifications) {
    PushNotifications = cap.Plugins.PushNotifications;
    source = "bridge.proxy";
  }
  if (!PushNotifications) return null;
  return { PushNotifications, platform: cap.getPlatform(), source };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPushPlugin(): Promise<{ PushNotifications: any; platform: string } | null> {
  return resolvePlugin();
}

let registrationWired = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wireRegistration(PushNotifications: any, platform: string) {
  if (registrationWired) return;
  registrationWired = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registration", (token: any) => {
    void apiFetch("/api/push/subscribe", { method: "POST", body: { token: token.value, platform } }).catch(() => {});
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await PushNotifications.addListener("registrationError", (err: any) => {
    report(`registrationError: ${JSON.stringify(err)}`);
  });
}

/**
 * Slår på push: be om tillstånd + registrera. Rapporterar ett diagnos-spår.
 * Returnerar {ok:false, reason} så UI:t kan visa varför det misslyckades.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  const trail: string[] = [];
  try {
    const p = await resolvePlugin();
    if (!p) {
      report("enablePush: ingen plugin (ej native/saknas)");
      return { ok: false, reason: "ej native eller plugin saknas i bygget" };
    }
    trail.push(`source=${p.source}`);
    await wireRegistration(p.PushNotifications, p.platform);
    trail.push("wired");
    const perm = await p.PushNotifications.requestPermissions();
    trail.push(`perm=${perm?.receive}`);
    if (perm?.receive !== "granted") {
      report(`enablePush: ${trail.join(" | ")}`);
      return { ok: false, reason: `behörighet: ${perm?.receive}` };
    }
    await p.PushNotifications.register();
    trail.push("register() resolved");
    report(`enablePush OK: ${trail.join(" | ")}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report(`enablePush THREW: ${trail.join(" | ")} | err=${msg}`);
    return { ok: false, reason: msg };
  }
}

/** Tyst om-registrering vid app-start om tillstånd redan givet (fångar roterade tokens). */
export async function refreshPush(): Promise<void> {
  try {
    report("refreshPush: mount/heartbeat");
    const p = await resolvePlugin();
    if (!p) {
      report("refreshPush: ingen plugin (ej native/saknas)");
      return;
    }
    report(`refreshPush: source=${p.source}`);
    await wireRegistration(p.PushNotifications, p.platform);
    const perm = await p.PushNotifications.checkPermissions();
    if (perm?.receive === "granted") await p.PushNotifications.register();
  } catch {
    /* tyst — bästa-ansträngning vid start */
  }
}
