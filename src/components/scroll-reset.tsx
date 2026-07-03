"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Nollställer scroll-positionen vid varje route-byte. Next:s inbyggda scroll-to-top
 * slår inte igenom i Capacitor-WebView:en (tabbarna delar samma scroll-container →
 * en ny tab ärvde Utforskas scroll-läge). Produkt-overlayn byter INTE pathname
 * (samma-URL-historik) → listans scroll bevaras som tänkt.
 */
// Layout-effect (före paint) på klienten → ingen blink av föregående scroll-läge.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function ScrollReset() {
  const pathname = usePathname();
  useIsoLayoutEffect(() => {
    // behavior:"instant" tvingar bort den mjuka animationen (html har scroll-smooth,
    // som annars fick sidan att "glida" ner från toppen vid tab-byte).
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}
