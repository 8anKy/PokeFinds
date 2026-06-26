"use client";
/**
 * Mountad i app-shellen. Hanterar tap på en push-notis (öppnar rätt app-vy via
 * Next-router — INTE location.assign, som skulle kasta ut till Safari i appen) och
 * gör en tyst om-registrering vid start så roterade tokens fångas. No-op på web.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshPush } from "@/lib/push-client";

export function PushManager() {
  const router = useRouter();
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const handle = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          const url = action.notification.data?.url;
          if (typeof url === "string" && url.startsWith("/")) router.push(url);
        }
      );
      cleanup = () => void handle.remove();
      await refreshPush();
    })();
    return () => cleanup?.();
  }, [router]);
  return null;
}
