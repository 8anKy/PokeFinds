/**
 * PROVPERIODENS TVÅ MEDDELANDEN (2026-10-19) — ren dom, ingen databas. Testad i
 * tests/unit/trial-messages.test.ts. Utskicket: src/services/trial-messages.ts,
 * anropat av morgonrundan (/api/cron/alerts-due, 07:00 svensk tid).
 *
 *   • Dag 7 — VÄRDET: en push om vad Pro gett ("46 kort skannade, 2 restock-larm").
 *     Aldrig ett pris, aldrig ett mejl (ägaren: veckobrevet kändes spammigt). Hoppas
 *     över när det inte finns något att visa — "0 kort skannade" påminner bara om att
 *     man inte använder det.
 *   • Dag 12 — PÅMINNELSEN: mejl + push med datum och pris, som arket lovar ("Vi
 *     påminner dig 2 dagar innan"). Mejlet är det som MÅSTE fram och stämplas först
 *     när det gått iväg; misslyckas det försöker nästa morgon igen, så länge det
 *     fortfarande är före Apples dragning (≥ 24 h före slutet).
 *
 * Dagarna räknas i SVENSKA kalenderdagar (samma klocka som veckoserien), inte i
 * timmar: rundan går en gång per morgon, och "dag 12" ska betyda samma morgon för
 * den som startade kl 06 och den som startade kl 23.
 */
import { stockholmDayKey } from "@/lib/streak";
import { TRIAL_REMINDER_DAYS_BEFORE, TRIAL_VALUE_DAY } from "@/lib/pro-plans";

const DAY_MS = 864e5;
/** Apple drar upp till 24 h före periodens slut — efter det är en påminnelse meningslös. */
const LAST_USEFUL_MS = 26 * 3600e3;

export interface TrialState {
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialValueSentAt: Date | null;
  trialReminderSentAt: Date | null;
  /** false = kunden har redan stängt av förnyelsen ⇒ inga meddelanden alls. */
  willRenew: boolean | null;
}

export type TrialMessage = "reminder" | "value";

function dayIndex(at: Date): number {
  return Math.round(Date.parse(`${stockholmDayKey(at)}T00:00:00Z`) / DAY_MS);
}

/** Vilket meddelande (om något) som ska gå ut i morgonens runda. */
export function trialMessageDue(state: TrialState, now: Date): TrialMessage | null {
  const { trialStartedAt, trialEndsAt } = state;
  if (!trialEndsAt || trialEndsAt.getTime() <= now.getTime()) return null;
  if (state.willRenew === false) return null;

  const today = dayIndex(now);
  const reminderDay = dayIndex(trialEndsAt) - TRIAL_REMINDER_DAYS_BEFORE;

  if (!state.trialReminderSentAt && today >= reminderDay) {
    return trialEndsAt.getTime() - now.getTime() >= LAST_USEFUL_MS ? "reminder" : null;
  }
  // Värdebeskedet bara FÖRE påminnelsedagen — samma morgon blir det två notiser.
  if (!state.trialValueSentAt && !state.trialReminderSentAt && trialStartedAt) {
    const valueDay = dayIndex(trialStartedAt) + TRIAL_VALUE_DAY;
    if (today >= valueDay && today < reminderDay) return "value";
  }
  return null;
}

export interface TrialUsage {
  scans: number;
  restockAlerts: number;
}

/** Värdebeskedet behöver något att visa. */
export function trialUsageWorthShowing(usage: TrialUsage): boolean {
  return usage.scans >= 3 || usage.restockAlerts >= 1;
}

/** "46 kort skannade, 2 restock-larm" — bara de delar som är > 0. */
export function trialUsageLine(usage: TrialUsage): string {
  const parts: string[] = [];
  if (usage.scans > 0) parts.push(`${usage.scans} ${usage.scans === 1 ? "kort skannat" : "kort skannade"}`);
  if (usage.restockAlerts > 0) parts.push(`${usage.restockAlerts} restock-larm`);
  return parts.join(", ");
}

/** Vad som händer efter provperioden, i klartext — avgörs av butiken och produkten. */
export type TrialPriceKind = "commit-monthly" | "annual-upfront";

export function trialPriceKind(source: string | null, productId: string | null): TrialPriceKind {
  // Apples 12-månadersåtagande har produkt-id `<id>:monthly` (RevenueCat-formatet).
  if (source === "STRIPE") return "commit-monthly";
  if (source === "APP_STORE" && productId?.endsWith(":monthly")) return "commit-monthly";
  return "annual-upfront";
}

/** "torsdag 6 november" — slutdatumet som kunden läser det. */
export function trialEndLabel(trialEndsAt: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
  }).format(trialEndsAt);
}
