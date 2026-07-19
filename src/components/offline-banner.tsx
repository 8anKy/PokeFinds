"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Offline-indikator (#21): en diskret banner när enheten tappar nätet. Lyssnar på
 * webbläsarens online/offline-events (fungerar i både webben och Capacitor-
 * WebView:en). Startvärde sätts först i useEffect — navigator.onLine finns inte på
 * servern och får inte skapa hydrerings-mismatch.
 */
export function OfflineBanner() {
  const t = useTranslations("Offline");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[60] flex items-center justify-center gap-2 bg-fall/90 px-4 py-2 text-center text-sm font-medium text-white backdrop-blur-sm"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-white/80" />
      {t("message")}
    </div>
  );
}
