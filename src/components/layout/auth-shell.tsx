"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Yttre skal för auth-sidorna. Capacitor kör Keyboard resize:none → WKWebView:en
 * krymper INTE när tangentbordet öppnas, så ett fokuserat fält (t.ex. bekräfta
 * lösenord) hamnar bakom tangentbordet om sidan inte kan scrolla.
 *
 * Fix utan visualViewport-beroende: ge sidan gott om botten-utrymme (pb-[40vh]) så
 * DOKUMENTET blir scrollbart, och skrolla det fokuserade fältet till mitten (ovanför
 * tangentbordet) när det får fokus — men BARA medan ett fält är fokuserat. I vila är
 * sidan exakt `min-h-[100dvh]` utan tomrymd, annars kan hela vyn (inkl. logotypen)
 * scrollas trots att allt får plats — vilket kändes trasigt på login-sidan.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const isField = (el: EventTarget | null): el is HTMLElement =>
      el instanceof HTMLElement && el.matches("input, textarea");
    const onFocusIn = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      setTyping(true);
      const t = e.target;
      // Vänta tills tangentbordet animerat upp innan vi skrollar fältet i vy.
      setTimeout(() => t.scrollIntoView({ block: "center" }), 300);
    };
    const onFocusOut = () => {
      // Vänta en tick: fokus kan flytta direkt till nästa fält — behåll utrymmet då
      // (annars kollapsar/expanderar paddingen och gör ett hopp mellan fälten).
      setTimeout(() => {
        if (!isField(document.activeElement)) setTyping(false);
      }, 50);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex min-h-[100dvh] flex-col items-center justify-start bg-surface-gradient px-4 mt-[calc(env(safe-area-inset-top)*-1)] pt-[calc(env(safe-area-inset-top)+1.5rem)]",
        typing ? "pb-[40vh]" : "pb-6"
      )}
    >
      {children}
    </div>
  );
}
