"use client";

import { useEffect } from "react";

/**
 * Döljer den NATIVE splash-skärmen när appen är redo (#21). Native splashen
 * ("Foilio") hålls uppe tills nu (launchAutoHide:false) så att app-starten inte
 * visar en svart skärm medan WebView:en laddar den hostade webben över nätet;
 * här — efter hydrering (useEffect = efter första commit/paint) — lämnar vi
 * över DIREKT till appen (Utforska). Ingen web-laddningsskärm emellan.
 *
 * Dynamisk import av Capacitor: webben drar aldrig in plugin-koden.
 */
export function AppBoot() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled || !Capacitor.isNativePlatform()) return;
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        // Splash-plugin saknas/webb → inget att dölja.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
