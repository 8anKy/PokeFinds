"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Nollställer scroll-positionen vid varje route-byte. Next:s inbyggda scroll-to-top
 * slår inte igenom i Capacitor-WebView:en (tabbarna delar samma scroll-container →
 * en ny tab ärvde Utforskas scroll-läge). Produkt-overlayn byter INTE pathname
 * (samma-URL-historik) → listans scroll bevaras som tänkt.
 */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  return null;
}
