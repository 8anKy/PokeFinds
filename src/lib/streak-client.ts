"use client";

/**
 * Klientsidan av veckoserien: servern sätter svarshuvudet `x-scoutr-streak` på dagens
 * FÖRSTA handling (services/streak.ts). Vi läser det på ETT ställe — ett omslag runt
 * window.fetch — i stället för i varje komponent som skannar, bevakar eller postar.
 * Det finns ett tiotal sådana anropsställen med både apiFetch och rå fetch; ett missat
 * ställe hade gett en handling som räknades men aldrig firades.
 *
 * Omslaget rör inte förfrågan och läser bara ett huvud ur svaret — inget extra anrop.
 */
import { STREAK_HEADER, type StreakEvent } from "@/lib/streak";

export const STREAK_EVENT = "scoutr:streak";

let installed = false;

export function installStreakFetchTap(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await original(...args);
    try {
      const raw = res.headers.get(STREAK_HEADER);
      if (raw) {
        const event = JSON.parse(decodeURIComponent(raw)) as StreakEvent;
        window.dispatchEvent(new CustomEvent<StreakEvent>(STREAK_EVENT, { detail: event }));
      }
    } catch {
      // Ett trasigt huvud får aldrig fälla själva anropet.
    }
    return res;
  };
}

export function onStreakEvent(handler: (e: StreakEvent) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<StreakEvent>).detail);
  window.addEventListener(STREAK_EVENT, listener);
  return () => window.removeEventListener(STREAK_EVENT, listener);
}
