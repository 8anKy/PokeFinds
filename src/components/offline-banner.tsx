"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Capacitor } from "@capacitor/core";

/**
 * Ingen anslutning-skärm (#21, Stitch-design "No Connection Screen - Foilio
 * Branded"): fullskärms-överlägg när enheten tappar nätet — wifi-off-ikon,
 * rubrik, beskrivning och en "Försök igen"-knapp. ENDAST i appen (ägaren): en
 * webbsajt har ingen sådan skärm. Lyssnar på webbläsarens online/offline-events.
 * Startvärde sätts först i useEffect — navigator.onLine finns inte på servern
 * och får inte skapa hydrerings-mismatch.
 */
export function OfflineBanner() {
  const t = useTranslations("Offline");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return; // app-only
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

  const retry = () => {
    // Tillbaka online → ladda om för färsk data. Fortfarande offline → skärmen
    // står kvar (online-eventet döljer den automatiskt när nätet är tillbaka).
    if (typeof navigator !== "undefined" && navigator.onLine) {
      window.location.reload();
    }
  };

  return (
    <div
      role="alertdialog"
      aria-label={t("title")}
      className="fixed inset-0 z-[70] flex flex-col bg-surface"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="text-holo-cyan">
          <WifiOffIcon />
        </span>
        <h1 className="mt-8 font-display text-2xl font-bold text-ink">{t("title")}</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-muted">
          {t("description")}
        </p>
      </div>
      <div className="px-6 pb-6">
        <button
          type="button"
          onClick={retry}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-holo-cyan py-4 text-sm font-semibold uppercase tracking-wide text-surface transition-colors hover:bg-brand-dark active:scale-[0.98]"
        >
          <RefreshIcon />
          {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}

function WifiOffIcon() {
  return (
    <svg
      width={72}
      height={72}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h.01" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
      <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
      <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
      <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
