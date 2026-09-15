"use client";
/**
 * Efterspelet till ett Bevaka-tryck med restock-larm (ägarbeslut 2026-09-15):
 * larmet ska kunna NÅ användaren. Kanalerna läses ur kontots inställningar
 * (GET /api/users/me) och det som är AV får en knuff, en gång per sidladdning:
 *
 *  - push av + nativ app  ⇒ be om OS-tillståndet direkt (enablePush) och, om ja,
 *    skriv `push: true` (PATCH mergar). Ett nej skriver ingenting.
 *  - e-post av            ⇒ säg det till anroparen (`email-off`) så en toast kan
 *    peka på Inställningar. ⛔ Aldrig slå PÅ mejl bakom ryggen — det är ett val
 *    användaren gjort.
 *
 * ⛔ Ingen prompt när push redan är PÅ i inställningarna: enablePush() hade då
 *    bara registrerat om enheten, och PATCH:en hade skrivit över ett medvetet AV
 *    om OS-tillståndet råkade vara beviljat sedan tidigare.
 * ⛔ Aldrig blockerande: allt här är best effort efter att bevakningen redan är
 *    sparad. Ett nej är inte ett fel.
 */
import { apiFetch } from "@/lib/client-api";
import { enablePush, getPushPlugin } from "@/lib/push-client";

export type WatchFollowup = "ok" | "push-enabled" | "email-off";

let done = false;

export async function promptChannelsAfterWatch(): Promise<WatchFollowup> {
  if (done) return "ok";
  done = true;
  try {
    const me = await apiFetch<{ notificationSettings?: { email?: boolean; push?: boolean } }>("/api/users/me");
    const settings = me.notificationSettings ?? {};
    let result: WatchFollowup = "ok";
    if (settings.push !== true && (await getPushPlugin())) {
      const res = await enablePush();
      if (res.ok) {
        await apiFetch("/api/users/me", { method: "PATCH", body: { notificationSettings: { push: true } } });
        result = "push-enabled";
      }
    }
    if (settings.email === false) return "email-off";
    return result;
  } catch {
    return "ok";
  }
}

/** @deprecated namnet före 2026-09-15 — samma sak, behållet för anropare. */
export const promptPushAfterWatch = promptChannelsAfterWatch;

/**
 * Felkoden servern svarar med när gratiskontot försöker slå på ett andra
 * restock-larm — klienten öppnar paywall-arket på den, aldrig på texten.
 */
export const FREE_RESTOCK_ALERT_LIMIT_CODE = "FREE_RESTOCK_ALERT_LIMIT";
