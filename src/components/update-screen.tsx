"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/social-links";
import { MIN_APP_VERSION } from "@/lib/app-version";
import { isEmailLandingRoute } from "@/lib/auth-routes";
import { localizedNote, updatePrompt, type ReleaseIcon, type UpdatePrompt } from "@/lib/app-release";
import release from "@/data/app-release.json";
import { markUpdateCheckDone } from "@/lib/boot-gate";
import type { AppRelease } from "@/lib/app-release";

/**
 * UPPDATERINGSSKÄRMEN (ägarbeslut 2026-10-06, ersätter den lilla remsan): täcker hela
 * appen när en nyare version finns i butiken, med versionens nyheter ur
 * `src/data/app-release.json` och en knapp till App Store / Google Play. När den
 * visas och för vilken version avgör `updatePrompt` (lib/app-release.ts, testad).
 *
 * VARFÖR I WEBBEN: appen är ett WebView-skal över foilio.se, så skärmen når varje
 * installerad version — även den som aldrig uppdaterats. Inget native-bygge behövs.
 *
 * ⛔ RÖR ALDRIG ETT PLUGIN SOM INTE FINNS I BYGGET: `isPluginAvailable("App")` före
 *    importen; webbuntet drar aldrig in plugin-koden.
 * ⛔ "Senare" gäller till nästa KALLSTART (modulvariabel, ingen localStorage — samma
 *    ägarbeslut som remsan 2026-09-06). Tvingad uppdatering har ingen "Senare".
 * ⛔ FRÅGESTRÄNGEN ÄR CACHE-SPÄRREN mot WKWebView:s egen HTTP-cache (se rutten).
 *
 * Kontrollen körs vid montering och när appen kommer tillbaka i förgrunden (högst en
 * gång i timmen) — WebView:en lever i dagar och ett släpp medan appen sover syntes
 * annars först vid nästa kallstart.
 */
const RECHECK_MIN_MS = 60 * 60 * 1000;
/** Versionen användaren skjutit upp i DEN HÄR sessionen — nollas av en kallstart. */
let dismissedVersion: string | null = null;

async function fetchIosStore(): Promise<{ version: string; released: string | null }> {
  try {
    const res = await fetch(`/api/app/min-version?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { version: MIN_APP_VERSION, released: null };
    const data = (await res.json()) as { ios?: unknown; iosReleased?: unknown };
    const version = typeof data.ios === "string" && data.ios.trim() ? data.ios.trim() : MIN_APP_VERSION;
    const released = typeof data.iosReleased === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.iosReleased) ? data.iosReleased : null;
    return { version, released };
  } catch {
    return { version: MIN_APP_VERSION, released: null };
  }
}

const ICON_PATHS: Record<ReleaseIcon, string> = {
  link: "M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5",
  store: "M3 9l1.5-5h15L21 9M4 9v11h16V9M9 20v-6h6v6",
  map: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  spark: "M12 3l1.9 5.8L20 10.7l-5.9 1.9L12 18.5l-2.1-5.9L4 10.7l6.1-1.9z",
};

function NoteIcon({ name }: { name?: ReleaseIcon }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-surface-overlay text-holo-cyan">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ICON_PATHS[name ?? "spark"]} />
      </svg>
    </span>
  );
}

export function UpdateScreen() {
  const t = useTranslations("UpdateScreen");
  const locale = useLocale();
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<UpdatePrompt | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  // Första kollen klar ⇒ släpp splashen (lib/boot-gate.ts). Effekten körs efter
  // commit, så en ny skärm finns redan i DOM:en när splashen börjar tona ut.
  const [firstCheckDone, setFirstCheckDone] = useState(false);
  useEffect(() => {
    if (firstCheckDone) markUpdateCheckDone();
  }, [firstCheckDone]);

  useEffect(() => {
    let cancelled = false;
    let lastCheckAt = 0;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("App")) return markUpdateCheckDone();
        const p = Capacitor.getPlatform();
        if (p !== "ios" && p !== "android") return markUpdateCheckDone();
        setPlatform(p);
        const { App } = await import("@capacitor/app");
        const check = async () => {
          if (Date.now() - lastCheckAt < RECHECK_MIN_MS) return;
          lastCheckAt = Date.now();
          try {
            const [info, iosStore] = await Promise.all([
              App.getInfo(),
              p === "ios" ? fetchIosStore() : Promise.resolve(null),
            ]);
            if (cancelled) return;
            const next = updatePrompt({
              platform: p,
              installed: info.version,
              release: release as AppRelease,
              iosStoreVersion: iosStore?.version,
              iosStoreReleased: iosStore?.released,
            });
            setPrompt(next && (next.mode === "required" || dismissedVersion !== next.version) ? next : null);
          } catch {
            // Pluginet svarade inte → behåll det vi visste.
          }
        };
        await check();
        if (!cancelled) setFirstCheckDone(true);
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void check();
        });
        if (cancelled) void handle.remove();
        else removeListener = () => void handle.remove();
      } catch {
        // Webb / plugin saknas → ingen skärm.
        markUpdateCheckDone();
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  if (!prompt) return null;
  // Mejllänkens landningssida (verifiera, återställ lösenord) får göra klart sitt först.
  if (isEmailLandingRoute(pathname)) return null;

  const required = prompt.mode === "required";
  const storeUrl = platform === "android" ? PLAY_STORE_URL : APP_STORE_URL;
  const released = prompt.released
    ? new Date(`${prompt.released}T12:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : "sv-SE", { day: "numeric", month: "long" })
    : null;
  const later = () => {
    dismissedVersion = prompt.version;
    setPrompt(null);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-screen-title"
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-surface text-ink"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Foliens sken bakom märket: turkos + violett, rött vid tvingad uppdatering. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-30%] top-[-25%] h-[60%] blur-md"
        style={{
          background: required
            ? "radial-gradient(closest-side, rgba(244,63,94,.22), transparent 70%), radial-gradient(closest-side at 70% 60%, rgba(167,139,250,.14), transparent 70%)"
            : "radial-gradient(closest-side, rgba(45,212,191,.28), transparent 70%), radial-gradient(closest-side at 70% 60%, rgba(167,139,250,.22), transparent 70%)",
        }}
      />
      {/* Huvudet står STILL (ägarbeslut 2026-10-06): märke, etikett, version och
          "Du har …" scrollas aldrig bort — bara nyhetslistan under rör sig. */}
      <div className="relative mx-auto flex w-full max-w-md shrink-0 flex-col px-6 pt-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/foilio-mark.svg" alt="Foilio" width={46} height={58} className="mb-5 h-auto w-[46px]" />
        <span
          className={`self-start rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
            required ? "border-fall/40 bg-fall/10 text-fall" : "border-holo-cyan/30 bg-holo-cyan/10 text-holo-cyan"
          }`}
        >
          {required ? t("pillRequired") : t("pill")}
        </span>
        <h1 id="update-screen-title" className="mt-3 text-[34px] font-extrabold leading-none tracking-[-0.035em]">
          Foilio{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(100deg, #2dd4bf, #5cc468 45%, #a78bfa 80%, #f472b6)" }}
          >
            {prompt.version}
          </span>
        </h1>
        <p className="mb-5 mt-2 text-[13px] text-ink-muted">
          {released ? t("installedReleased", { installed: prompt.installed, version: prompt.version, date: released }) : t("installed", { installed: prompt.installed })}
        </p>
        {required && <p className="mb-4 text-sm leading-relaxed text-ink">{t("requiredText")}</p>}
      </div>
      {/* Bara listan scrollar. Kanterna tonas ut så det syns att det finns mer. */}
      <div
        className="relative mx-auto w-full max-w-md min-h-0 flex-1 overflow-y-auto overscroll-contain px-6"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 28px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 28px), transparent 100%)",
        }}
      >
        <div className="grid gap-2.5 pb-7 pt-2.5">
          {prompt.notes.length > 0 ? (
            prompt.notes.map((note) => {
              const n = localizedNote(note, locale);
              return (
                <div key={n.title} className="grid grid-cols-[36px_1fr] items-start gap-3 rounded-2xl border border-surface-border p-3">
                  <NoteIcon name={note.icon} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold leading-snug">{n.title}</h2>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{n.text}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="grid grid-cols-[36px_1fr] items-center gap-3 rounded-2xl border border-surface-border p-3">
              <NoteIcon name="spark" />
              <p className="text-sm text-ink-muted">{t("fallbackNote")}</p>
            </div>
          )}
        </div>
      </div>
      <div className="relative mx-auto grid w-full max-w-md gap-1 px-6 pb-5 pt-3">
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[50px] items-center justify-center rounded-2xl bg-holo-cyan text-base font-bold text-surface transition-transform active:scale-[0.98]"
        >
          {required ? t("updateNow") : t("update")}
        </a>
        {!required && (
          <button type="button" onClick={later} className="h-11 text-sm font-semibold text-ink-muted transition-colors hover:text-ink">
            {t("later")}
          </button>
        )}
      </div>
    </div>
  );
}
