"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { Capacitor } from "@capacitor/core";

/**
 * I native-appen (Capacitor) öppnar vi Utforska, inte marknadsförings-startsidan —
 * app-användare ska inte mötas av en "gå med"-pitch. På webben gör den ingenting.
 *
 * `redirected` är MODUL-nivå (inte en ref) → router.replace körs HÖGST EN gång per
 * app-start, även om komponenten re-renderar eller mountas om. Annars kunde en
 * instabil router-referens eller en återmontering trigga replace om och om igen
 * = reload-loop ("flimmer") i WebView:en.
 */
let redirected = false;

/** Läser det sparade språkvalet (NEXT_LOCALE-cookien). */
function savedLocale(): "sv" | "en" | null {
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(sv|en)\b/);
  return (m?.[1] as "sv" | "en") ?? null;
}

export function NativeHomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (redirected || !Capacitor.isNativePlatform()) return;
    redirected = true;
    // Appen startar alltid på "/" (= default-locale sv med `as-needed`), så en
    // EN-användare skulle annars landa på svenska. Tvinga fram det SPARADE språket
    // här — cookien är källan till sanning, inte den prefix-lösa start-URL:en.
    const locale = savedLocale();
    router.replace("/produkter", locale ? { locale } : undefined);
  }, [router]);
  return null;
}
