"use client";

import { useSyncExternalStore } from "react";
import { BETA_COOKIE, NATIVE_UA_TAG } from "@/lib/community-v2-gate";

/**
 * Klientsidans spegel av community-grinden (lib/community-v2-gate.ts): får den
 * här besökaren se Forum/Meddelanden i navigeringen?
 *
 * Tre källor, ingen serverfråga: lanseringsspaken (inbakad vid bygget), appens
 * UA-tagg, och `fo_beta`-cookien som middleware satte senast servern släppte
 * igenom (t.ex. admin). Servern förblir facit — det här styr bara vad
 * bottenflikarna och /mer visar.
 *
 * Läses SYNKRONT via useSyncExternalStore: serverrenderingen och hydreringen
 * ser bara lanseringsspaken (ingen hydreringsvarning), varje annan montering
 * ser det riktiga värdet direkt. Headerns navigering remonteras vid varje
 * flikbyte (egen layout per routegrupp) — med en effekt-läsning bytte
 * "Community" → "Forum" synligt varje gång.
 */
export function communityV2ClientAllowed(): boolean {
  if (process.env.NEXT_PUBLIC_COMMUNITY_V2_PUBLIC === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    if (navigator.userAgent.includes(NATIVE_UA_TAG)) return true;
    return document.cookie.split(/;\s*/).some((c) => c === `${BETA_COOKIE}=1`);
  } catch {
    return false;
  }
}

// Ingen händelse att lyssna på — UA:n är fast och cookien sätts av servern; varje
// omrendering (t.ex. pathname-byte) läser om ögonblicksbilden ändå.
const subscribeNoop = () => () => {};
const serverSnapshot = () => process.env.NEXT_PUBLIC_COMMUNITY_V2_PUBLIC === "1";

export function useCommunityV2(): boolean {
  return useSyncExternalStore(subscribeNoop, communityV2ClientAllowed, serverSnapshot);
}
