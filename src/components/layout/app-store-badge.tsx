"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { APP_STORE_URL } from "@/lib/social-links";
import { IconAppleLogo } from "@/components/ui/brand-icons";

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

export function AppStoreBadge() {
  const t = useTranslations("JoinUs");
  const nativeApp = useSyncExternalStore(subscribeNoop, isNativeApp, serverSnapshot);

  if (nativeApp) return null;

  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("badgeAria")}
      // `web-only`: gömd av CSS redan vid första målningen i appen (se rot-layoutens
      // inline-skript) — useSyncExternalStore ovan tar bort den ur DOM:en efteråt.
      className="web-only inline-flex items-center gap-2.5 rounded-xl border border-white/25 bg-black px-3.5 py-1.5 transition-colors hover:border-white/50"
    >
      <IconAppleLogo size={22} className="shrink-0 text-white" />
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[10px] font-medium text-white/75">{t("badgeTagline")}</span>
        <span className="-mt-0.5 text-sm font-semibold text-white">App Store</span>
      </span>
    </a>
  );
}
