"use client";

import { useEffect } from "react";

/**
 * Capacitor kör Keyboard resize:none → WebView:en krymper INTE när tangentbordet
 * öppnas, så ett fokuserat fält (t.ex. lösenord vid registrering) kan hamna bakom
 * tangentbordet. Skrolla in det fokuserade fältet i vy när det får fokus.
 */
export function AuthKeyboardScroll() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.matches("input, textarea")) return;
      // Vänta tills tangentbordet animerat upp innan vi mäter/skrollar.
      setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
  return null;
}
