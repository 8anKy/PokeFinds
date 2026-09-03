"use client";

import { useEffect, useState } from "react";
import { BETA_COOKIE, NATIVE_UA_TAG } from "@/lib/community-v2-gate";

/**
 * Klientsidans spegel av community-grinden (lib/community-v2-gate.ts): får den
 * här besökaren se Forum/Meddelanden i navigeringen?
 *
 * Tre källor, ingen serverfråga: lanseringsspaken (inbakad vid bygget), appens
 * UA-tagg, och `fo_beta`-cookien som middleware satte senast servern släppte
 * igenom (t.ex. admin). Servern förblir facit — det här styr bara vad
 * bottenflikarna och /mer visar. Startar som `false` så SSR och första
 * klientrenderingen är lika (ingen hydreringsvarning); flikarna byter etikett
 * strax efter montering.
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

export function useCommunityV2(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(communityV2ClientAllowed());
  }, []);
  return allowed;
}
