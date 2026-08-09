"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Uppdaterar sidans data när appen VAKNAR efter att ha legat i bakgrunden.
 *
 * VARFÖR: OS:et fryser WebView:en när appen swipas ut till app-växlaren (inga
 * timers, ingen CPU — det är gratis). Men när användaren öppnar appen nästa morgon
 * TINAS exakt samma DOM upp: gårdagens priser, gårdagens lagerstatus, och efter en
 * deploy även GAMLA Server Action-id:n (loggarna visar "Failed to find Server
 * Action … older deployment" från precis sådana återupptagna sessioner). Inget i
 * appen märkte att timmar gått — den såg ut att "alltid vara på".
 *
 * `visibilitychange` fyras av WKWebView/Chrome både för flikbyte på webben och
 * bakgrund/förgrund i Capacitor-appen — en implementation för alla tre ytorna,
 * ingen Capacitor-plugin behövs.
 *
 * ⛔ `router.refresh()`, ALDRIG `window.location.reload()`: hård reload i
 * Capacitor kan kasta användaren ur WebView:en till Safari (dokumenterad fälla),
 * och en reload slänger dessutom klient-state (scrollposition, öppna ark).
 * refresh() hämtar bara om RSC-datat för aktuell route — ISR-cachade sidor svarar
 * ur cachen (ingen Neon-väckning), inloggade vyer får färskt data.
 *
 * Tröskeln: ett flikbyte på sekunder ska INTE kosta en refetch — först när appen
 * varit dold längre än priserna/lagret hinner bli inaktuella är datat misstänkt.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

export function AppResumeRefresh() {
  const router = useRouter();
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt != null && Date.now() - hiddenAt >= STALE_AFTER_MS) {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  return null;
}
