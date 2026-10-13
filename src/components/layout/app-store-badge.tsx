"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/social-links";
import { IconAppleLogo, IconGooglePlay } from "@/components/ui/brand-icons";

/**
 * "Ladda ned på App Store"-brickan, ritad själv (glyf + text) i stället för
 * Apples bild: skarp i alla storlekar, texten följer språkvalet och inga
 * externa assets. Svart med vit hårlinje oavsett tema — brickan är Apples
 * formspråk, inte vårt, och ytan är ändå svart.
 *
 * Döljer sig själv i NATIVE-appen: att be en app-användare ladda ned appen är
 * brus. Webben SSR:ar brickan (ingen layout-skift där).
 *
 * ⛔ Native-kollen är SYNKRON (bryggans `window.Capacitor`, injicerad av den
 * native appen före all sidkod — samma läsning som lib/haptics.ts och
 * cookie-banner.tsx), inte en effekt efter en dynamisk import: Utforska-sidan
 * remonteras vid varje flikbyte, och en effekt-läsning målade brickan en runda
 * ovanför sökfältet innan den försvann (rapporterat 2026-09-06). Med
 * useSyncExternalStore ser serverrenderingen och hydreringen webbens värde
 * (ingen mismatch) och varje annan montering appens — brickan ritas aldrig i
 * appen vid en klientnavigering. Kallstarten täcks av CSS:
 * rot-layoutens inline-skript stämplar <html data-native> före första målningen
 * och `.web-only` döljer brickan tills React tagit bort den.
 */
function isNativeApp(): boolean {
  return (
    (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ===
    true
  );
}
const subscribeNoop = () => () => {};
const serverSnapshot = () => false;

const BADGE_CLASS =
  "inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black px-2.5 py-1 transition-colors hover:border-white/50";

/**
 * Båda butiksbrickorna sida vid sida (App Store först, Google Play bredvid —
 * Android-appen är live sedan 2026-10-12). Alla visas för alla: servern vet inte
 * vilken telefon besökaren har (ISR-cachad sida), och en klientbyte efter
 * hydreringen hade hoppat i layouten.
 */
export function AppStoreBadge() {
  const t = useTranslations("JoinUs");
  const nativeApp = useSyncExternalStore(subscribeNoop, isNativeApp, serverSnapshot);

  if (nativeApp) return null;

  return (
    // `web-only`: gömd av CSS redan vid första målningen i appen (se rot-layoutens
    // inline-skript) — useSyncExternalStore ovan tar bort den ur DOM:en efteråt.
    <div className="web-only flex items-center gap-2">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("badgeAria")}
        className={BADGE_CLASS}
      >
        <IconAppleLogo size={17} className="shrink-0 text-white" />
        <span className="flex flex-col text-left leading-tight">
          <span className="text-[8.5px] font-medium text-white/75">{t("badgeTagline")}</span>
          <span className="-mt-0.5 text-xs font-semibold text-white">App Store</span>
        </span>
      </a>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("playBadgeAria")}
        className={BADGE_CLASS}
      >
        <IconGooglePlay size={15} className="shrink-0" />
        <span className="flex flex-col text-left leading-tight">
          <span className="text-[8.5px] font-medium text-white/75">{t("playBadgeTagline")}</span>
          <span className="-mt-0.5 text-xs font-semibold text-white">Google Play</span>
        </span>
      </a>
    </div>
  );
}
