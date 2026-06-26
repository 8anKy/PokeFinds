"use client";
/**
 * Mountad i app-shellen. Hanterar tap på en push-notis (öppnar rätt app-vy via
 * Next-router — INTE location.assign, som skulle kasta ut till Safari i appen) och
 * gör en tyst om-registrering vid start så roterade tokens fångas. No-op på web.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPushPlugin, refreshPush } from "@/lib/push-client";

export function PushManager() {
  const router = useRouter();
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
