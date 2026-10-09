"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import {
  hasUnseen,
  nextSeen,
  sectionOf,
  UNSEEN_REFRESH_MS,
  UNSEEN_SECTIONS,
  UNSEEN_STORAGE_KEYS,
  type UnseenSection,
} from "@/lib/unseen";

/**
 * Klientens halva av "något nytt"-pricken (lib/unseen.ts): EN modulnivå-butik som
 * alla prickar delar, så flikraden, headern och sidomenyn gör ETT anrop tillsammans.
 * Frågar `/api/unseen` när första pricken monteras och när appen kommer tillbaka
 * till förgrunden — högst en gång per UNSEEN_REFRESH_MS, aldrig på timer.
 */
type State = Record<UnseenSection, boolean>;

let latest: Record<UnseenSection, string | null> = { community: null, news: null };
let state: State = { community: false, news: false };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let visibilityHooked = false;

function readSeen(section: UnseenSection): number {
  try {
    return Number(window.localStorage.getItem(UNSEEN_STORAGE_KEYS[section])) || 0;
  } catch {
    return 0;
  }
}

function recompute() {
  const next: State = {
    community: hasUnseen(latest.community, readSeen("community")),
    news: hasUnseen(latest.news, readSeen("news")),
  };
  if (next.community === state.community && next.news === state.news) return;
  state = next;
  listeners.forEach((l) => l());
}

/** Sektionen är öppnad nu — släck pricken (sparas i serverns tid, se nextSeen). */
export function markSectionSeen(section: UnseenSection) {
  try {
    window.localStorage.setItem(UNSEEN_STORAGE_KEYS[section], String(nextSeen(Date.now(), latest[section])));
  } catch {
    // Privat läge / blockerad lagring: pricken släcks bara för den här sessionen.
  }
  recompute();
}

async function refresh() {
  if (inflight || Date.now() - lastFetch < UNSEEN_REFRESH_MS) return;
  lastFetch = Date.now();
  inflight = (async () => {
    try {
      const res = await fetch("/api/unseen", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const body = (await res.json()) as Partial<Record<UnseenSection, string | null>>;
      latest = { community: body.community ?? null, news: body.news ?? null };
      // Står man redan i sektionen när svaret kommer har man sett det.
      const here = sectionOf(window.location.pathname);
      if (here) markSectionSeen(here);
      recompute();
    } catch {
      // Nätfel: ingen prick hellre än en felaktig.
    } finally {
      inflight = null;
    }
  })();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!visibilityHooked) {
    visibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refresh();
    });
  }
  void refresh();
  return () => listeners.delete(listener);
}

/** Ska pricken visas på sektionens knapp? */
export function useUnseen(section: UnseenSection): boolean {
  return useSyncExternalStore(subscribe, () => state[section], () => false);
}

/** Monteras en gång (rot-layouten): öppnad sektion = sedd. */
export function useMarkSeenOnRoute() {
  const pathname = usePathname();
  useEffect(() => {
    const here = sectionOf(pathname);
    if (here) markSectionSeen(here);
  }, [pathname]);
}

export { UNSEEN_SECTIONS };
