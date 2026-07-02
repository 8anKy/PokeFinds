"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Yttre skal för auth-sidorna. Capacitor kör Keyboard resize:none → WKWebView:en
 * krymper INTE när tangentbordet öppnas, så ett fokuserat fält (t.ex. bekräfta
 * lösenord) hamnar bakom tangentbordet om sidan inte kan scrolla.
 *
 * Fix utan visualViewport-beroende: ge sidan gott om botten-utrymme (pb-[40vh]) så
 * DOKUMENTET blir scrollbart, och skrolla det fokuserade fältet till mitten (ovanför
 * tangentbordet) när det får fokus. `min-h-[100dvh]` gör att korta sidor (login) inte
 * får någon scrollbar tomrymd — paddingen absorberas.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.matches("input, textarea")) return;
      // Vänta tills tangentbordet animerat upp innan vi skrollar fältet i vy.
      setTimeout(() => t.scrollIntoView({ block: "center" }), 300);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-start bg-surface-gradient px-4 pb-[40vh] mt-[calc(env(safe-area-inset-top)*-1)] pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      {children}
    </div>
  );
}
