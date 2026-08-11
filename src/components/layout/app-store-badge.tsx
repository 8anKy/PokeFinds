"use client";

import { useEffect, useState } from "react";
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
 * brus. Webben SSR:ar brickan (ingen layout-skift där); i appen blinkar den
 * som värst en frame innan effekten hunnit läsa Capacitor. Samma dynamiska
 * import som AppBoot — webb-bundlen drar aldrig in plugin-koden.
 */
export function AppStoreBadge() {
  const t = useTranslations("JoinUs");
  const [nativeApp, setNativeApp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!cancelled && Capacitor.isNativePlatform()) setNativeApp(true);
      } catch {
        // Ren webb utan Capacitor → brickan visas.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (nativeApp) return null;

  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("badgeAria")}
      className="inline-flex items-center gap-2.5 rounded-xl border border-white/25 bg-black px-3.5 py-1.5 transition-colors hover:border-white/50"
    >
      <IconAppleLogo size={22} className="shrink-0 text-white" />
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[10px] font-medium text-white/75">{t("badgeTagline")}</span>
        <span className="-mt-0.5 text-sm font-semibold text-white">App Store</span>
      </span>
    </a>
  );
}
