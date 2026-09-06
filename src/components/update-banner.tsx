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
 * Kontrollen körs vid montering OCH varje gång appen kommer tillbaka i
 * förgrunden (högst en gång i timmen) — WebView:en lever i dagar och ett släpp
 * som sker medan appen sover syntes annars först vid nästa kallstart.
 *
 * "Stäng" tystar remsan BARA tills nästa kallstart (ägarbeslut 2026-09-06: den
 * ska komma tillbaka varje gång appen öppnas på nytt). Minnet är en modul-
 * variabel — den överlever timkontrollerna i samma session men inte en omstart.
 * ⛔ Ingen localStorage: en sju dygns tystnad dolde remsan för ägaren själv.
 *
 * Döljs där den skulle skymma något: skannern (helskärmskamera),
 * mejl-landningssidorna och medan tangentbordet är uppe (samma mätning som
 * bottenflikarna). Ligger på z-30: produkt-overlayn (z-40) och flikarna (z-40)
 * målas ovanpå, precis som med allt annat sidinnehåll.
 */
const HIDDEN_ROUTES = ["/skanna"];
/** Versionen användaren stängde i DEN HÄR sessionen — nollas av en kallstart. */
let dismissedVersion: string | null = null;
// Minsta avstånd mellan två kontroller — vid montering och vid varje återkomst till förgrunden.
const RECHECK_MIN_MS = 60 * 60 * 1000;

/**
 * Tröskeln = versionen som ligger i App Store just nu (/api/app/min-version,
 * Apples lookup, cachad 10 min på servern + 5 min på kanten). Faller anropet svaras golvet
 * `MIN_APP_VERSION` — samma beteende som före 2026-09-02, aldrig en remsa mot
 * en version som inte går att hämta. Bara appen frågar; webben når aldrig hit.
 */
async function fetchMinVersion(): Promise<string> {
  try {
    // ⛔ FRÅGESTRÄNGEN ÄR CACHE-SPÄRREN, INTE `cache: "no-store"` (2026-09-06):
    // WKWebView ignorerar fetch-alternativet och svarade ur sin EGEN HTTP-cache
    // — ägarens telefon kallstartade tre gånger utan att en enda begäran nådde
    // servern (Railways loggar), och "1.1" satt kvar en timme efter släppet.
    const res = await fetch(`/api/app/min-version?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return MIN_APP_VERSION;
    const data = (await res.json()) as { ios?: unknown };
    return typeof data.ios === "string" && data.ios.trim() ? data.ios.trim() : MIN_APP_VERSION;
  } catch {
    return MIN_APP_VERSION;
  }
}

export function UpdateBanner() {
  const t = useTranslations("UpdateBanner");
  const pathname = usePathname();
  const [outdated, setOutdated] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastCheckAt = 0;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
        if (!Capacitor.isPluginAvailable("App")) return;
        const { App } = await import("@capacitor/app");
        const check = async () => {
          if (Date.now() - lastCheckAt < RECHECK_MIN_MS) return;
          lastCheckAt = Date.now();
          try {
            const [info, min] = await Promise.all([App.getInfo(), fetchMinVersion()]);
            if (cancelled) return;
            setOutdated(isOutdatedAppVersion(info.version, min) && dismissedVersion !== min ? min : null);
          } catch {
            // Pluginet svarade inte → behåll det vi visste.
          }
        };
        await check();
        // ⛔ Inte bara vid montering: WebView:en lever i dagar i bakgrunden, och
        // ett släpp som sker medan appen sover syntes annars först vid nästa
        // KALLSTART — den som aldrig stänger appen fick aldrig remsan. Fråga om
        // varje gång appen kommer tillbaka i förgrunden, som mest en gång i timmen
        // (rutten är DB-fri och processcachad, men varje anrop går genom Railway).
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void check();
        });
        if (cancelled) void handle.remove();
        else removeListener = () => void handle.remove();
      } catch {
        // Webb / plugin saknas → ingen remsa.
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
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
    dismissedVersion = outdated;
    setOutdated(null);
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
            {t("title", { version: outdated })}
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
