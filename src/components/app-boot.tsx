"use client";

import { useEffect } from "react";

/**
 * "Appen är redo"-signal (#21). Körs efter hydrering (useEffect = efter första
 * commit/paint) och gör två saker:
 *
 *  1. Markerar <html class="app-ready"> → CSS fejdar ut #app-loader (den
 *     branded laddningsskärmen som ligger i SSR-HTML:en och täcker
 *     nätverks-/hydreringsgapet).
 *  2. I native-appen (Capacitor): döljer den native splash-skärmen, som hålls
 *     uppe tills nu (launchAutoHide:false) så att app-starten INTE visar en svart
 *     skärm medan WebView:en laddar den hostade webben över nätet. Splashen och
 *     web-laddaren är visuellt identiska (mörk yta + Foilio-märke) → sömlöst.
 *
 * Dynamisk import av Capacitor: webben drar aldrig in plugin-koden.
 */
export function AppBoot() {
  useEffect(() => {
    document.documentElement.classList.add("app-ready");
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled || !Capacitor.isNativePlatform()) return;
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        // Splash-plugin saknas/webb → strunt i det, web-laddaren döljs ändå.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
