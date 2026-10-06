"use client";

import { useEffect } from "react";
import { waitForUpdateCheck } from "@/lib/boot-gate";

/**
 * Döljer den NATIVE splash-skärmen när appen är redo (#21). Splashen ("Foilio" +
 * F-märket på mörk yta, ingen spinner sedan 2026-09-17) hålls uppe tills nu
 * (launchAutoHide:false) så att app-starten inte visar en svart skärm medan
 * WebView:en laddar den hostade webben över nätet; här — efter hydrering
 * (useEffect = efter första commit/paint) — lämnar vi över DIREKT till appen.
 *
 * Dynamisk import av Capacitor: webben drar aldrig in plugin-koden.
 *
 * ⛔ Splashen väntar på uppdateringskollen (lib/boot-gate.ts, max 2,5 s) — annars
 *    syntes katalogen en kort stund innan uppdateringsskärmen la sig över den.
 */
export function AppBoot() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled || !Capacitor.isNativePlatform()) return;
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await waitForUpdateCheck();
        // Två bildrutor: uppdateringsskärmen (om någon) hinner målas under splashen.
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        if (cancelled) return;
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
