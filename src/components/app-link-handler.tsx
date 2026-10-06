"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { appLinkPath } from "@/lib/app-links";

/**
 * Öppnar rätt sida när appen startas från en foilio.se-länk (mejlknapp, Discord,
 * delad länk). Utan den här landade varje universell länk på startsidan: iOS/Android
 * öppnar APPEN, men WebView:en laddar `server.url` och vet inget om länken.
 *
 * Två vägar in, båda behövs:
 *   • `appUrlOpen` — appen låg i bakgrunden och väcks av länken.
 *   • `getLaunchUrl()` — appen KALLSTARTADES av länken; händelsen hann gå innan
 *     lyssnaren fanns.
 *
 * ⛔ RÖR ALDRIG ETT PLUGIN SOM INTE FINNS I BYGGET (samma regel som update-screen):
 *    `isPluginAvailable("App")` före importen; webben drar aldrig in plugin-koden.
 * ⛔ Domen bor i `lib/app-links.ts` (ren, testad) — inga URL-regler här.
 */
export function AppLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    const go = (url: string | undefined) => {
      const path = appLinkPath(url);
      if (!path || cancelled) return;
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (path !== here) router.push(path);
    };
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;
        const { App } = await import("@capacitor/app");
        const launch = await App.getLaunchUrl().catch(() => undefined);
        go(launch?.url);
        const handle = await App.addListener("appUrlOpen", ({ url }) => go(url));
        if (cancelled) void handle.remove();
        else removeListener = () => void handle.remove();
      } catch {
        // Webb / plugin saknas → inget att göra.
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [router]);

  return null;
}
