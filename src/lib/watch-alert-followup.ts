"use client";
/**
 * Efterspelet till ett Bevaka-tryck med restock-larm (ägarbeslut 2026-09-15):
 * larmet ska kunna NÅ användaren, så i den nativa appen ber vi om push-tillstånd
 * direkt här — inte i en inställning ingen hittar. Mejl är redan på för varje
 * konto (notificationSettings.email default true), så det behöver inget samtycke
 * i det här steget.
 *
 * ⛔ Frågar bara när OS:et inte redan avgjort saken: `enablePush()` prompt:ar
 *    bara om tillståndet är "prompt" och är no-op på webben. Blir det ja skrivs
 *    `push: true` i inställningarna (PATCH mergar) — annars registreras token
 *    utan att utskicket någonsin läser den (settings.push är master i
 *    dispatchPendingAlerts).
 * ⛔ Aldrig blockerande: allt här är best effort efter att bevakningen redan är
 *    sparad. Ett nej är inte ett fel.
 */
import { apiFetch } from "@/lib/client-api";
import { enablePush } from "@/lib/push-client";

let asked = false;

export async function promptPushAfterWatch(): Promise<void> {
  if (asked) return;
  asked = true;
  try {
    const res = await enablePush();
    if (!res.ok) return;
    await apiFetch("/api/users/me", { method: "PATCH", body: { notificationSettings: { push: true } } });
  } catch {
    // Best effort — bevakningen är redan sparad och mejlet går ändå.
  }
}

/**
 * Felkoden servern svarar med när gratiskontot försöker slå på ett andra
 * restock-larm — klienten öppnar paywall-arket på den, aldrig på texten.
 */
export const FREE_RESTOCK_ALERT_LIMIT_CODE = "FREE_RESTOCK_ALERT_LIMIT";
