"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { APP_STORE_URL } from "@/lib/social-links";
import { MIN_APP_VERSION, isOutdatedAppVersion } from "@/lib/app-version";
import { isEmailLandingRoute } from "@/lib/auth-routes";
import { IconSparkle, IconX } from "@/components/ui/icons";

/**
 * "Foilio 1.1 finns i App Store" — en liten remsa ovanför bottenflikarna, BARA i
 * iOS-appen och BARA när den installerade versionen är äldre än
 * `MIN_APP_VERSION` (lib/app-version.ts).
 *
 * VARFÖR: iOS säger aldrig till själv, och den som stängt av automatiska
 * uppdateringar (ägaren själv, 2026-08-30) kör 1.0 tills vidare utan att veta
 * att Google-/Apple-inloggningen och gästskanningen finns. Webben når varje
 * installerad app — remsan tänds utan nytt native-bygge.
 *
 * ⛔ BARA iOS. Android ligger inte på Google Play (versionCode 1, ingen
 * Play-länk) — en sidoladdad app har ingen butik att uppdatera från, och en
 * remsa utan väg framåt är bara brus.
 *
 * ⛔ RÖR ALDRIG ETT PLUGIN SOM INTE FINNS I BYGGET (samma regel som
 * lib/device-id.ts): `isPluginAvailable("App")` före importen. Dynamisk import
 * som AppBoot — webbuntet drar aldrig in plugin-koden.
 *
 * Tyst i sju dygn efter "Stäng" (localStorage per version — en ny version
 * nollar den). Döljs där den skulle skymma något: skannern (helskärmskamera),
 * mejl-landningssidorna och medan tangentbordet är uppe (samma mätning som
 * bottenflikarna). Ligger på z-30: produkt-overlayn (z-40) och flikarna (z-40)
 * målas ovanpå, precis som med allt annat sidinnehåll.
 */
const DISMISS_KEY = `foilio-update-dismissed:${MIN_APP_VERSION}`;
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const HIDDEN_ROUTES = ["/skanna"];

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

export function UpdateBanner() {
  const t = useTranslations("UpdateBanner");
  const pathname = usePathname();
  const [outdated, setOutdated] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
        if (!Capacitor.isPluginAvailable("App")) return;
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        if (cancelled || !isOutdatedAppVersion(info.version) || recentlyDismissed()) return;
        setOutdated(true);
      } catch {
        // Webb / plugin saknas → ingen remsa.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!outdated) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboard(window.innerHeight - vv.height > 120);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, [outdated]);

  if (!outdated || keyboard) return null;
  if (isEmailLandingRoute(pathname)) return null;
  if (HIDDEN_ROUTES.some((p) => pathname === p || pathname?.startsWith(`${p}/`))) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Privat läge/kvot — remsan försvinner ändå för den här sessionen.
    }
    setOutdated(false);
  };

  return (
    <div
      role="status"
      className="fixed inset-x-2.5 z-30 lg:inset-x-auto lg:right-6 lg:max-w-sm"
      // 4rem = bottenflikarnas höjd (h-16) + deras safe-area + 10px luft (sidans gutter).
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 10px)" }}
    >
      <div className="flex items-center gap-3 rounded-xl border border-holo-cyan/30 bg-surface-raised/95 px-3.5 py-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md">
        <IconSparkle size={18} className="shrink-0 text-holo-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-ink">
            {t("title", { version: MIN_APP_VERSION })}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-ink-muted">{t("body")}</p>
        </div>
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-holo-cyan px-3 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-[#14b8a6] active:scale-[0.98]"
        >
          {t("cta")}
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="-mr-1 shrink-0 rounded-md p-1 text-ink-muted transition-colors hover:text-ink"
        >
          <IconX size={16} />
        </button>
      </div>
    </div>
  );
}
