"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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

export function NativeHomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (redirected || !Capacitor.isNativePlatform()) return;
    redirected = true;
    router.replace("/produkter");
  }, [router]);
  return null;
}
