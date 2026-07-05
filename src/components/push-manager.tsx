"use client";
/**
 * Mountad i app-shellen. Hanterar tap på en push-notis (öppnar rätt app-vy via
 * Next-router — INTE location.assign, som skulle kasta ut till Safari i appen) och
 * gör en tyst om-registrering vid start så roterade tokens fångas. No-op på web.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { getPushPlugin, refreshPush } from "@/lib/push-client";

export function PushManager() {
  const router = useRouter();
  // Router via ref → effekten kan köra EN gång ([] deps). Med [router] kunde den
  // re-köras (t.ex. när notis-permission beviljas → re-render → instabil router-ref)
  // och om-registrera/refreshPush i en loop = reload-flimmer i WebView:en.
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void (async () => {
      const p = await getPushPlugin();
      if (!p) return;
      const handle = await p.PushNotifications.addListener(
        "pushNotificationActionPerformed",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (action: any) => {
          const url = action?.notification?.data?.url;
          if (typeof url !== "string") return;
          // In-app-sida → Next-router. Extern butikslänk (feed-först-larm) → system-
          // webbläsaren via window.open (öppnar utanför WebView:en, som mejlet).
          if (url.startsWith("/")) routerRef.current.push(url);
          else if (/^https?:\/\//.test(url)) window.open(url, "_blank");
        }
      );
      cleanup = () => void handle.remove();
      await refreshPush();
    })();
    return () => cleanup?.();
  }, []);
  return null;
}
