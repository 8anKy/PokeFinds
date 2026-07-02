"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function scrollActiveIntoView() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el.matches("input, textarea")) {
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
  }
}

/**
 * Yttre skal för auth-sidorna. Capacitor kör Keyboard resize:none → WKWebView:en
 * krymper INTE när tangentbordet öppnas, så en vanlig 100dvh-sida behåller full
 * höjd och fokuserade fält (t.ex. bekräfta lösenord) hamnar bakom tangentbordet.
 *
 * Samma lösning som Modal.tsx: när tangentbordet är uppe pinnar vi skalet till den
 * SYNLIGA ytan (visualViewport top/height) → innehållet blir högre än ytan och kan
 * scrolla, och vi skrollar fram det fokuserade fältet ovanför tangentbordet.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [vp, setVp] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => {
      setVp(window.innerHeight - v.height > 120 ? { top: v.offsetTop, height: v.height } : null);
    };
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, []);

  // Byte mellan fält medan tangentbordet redan är uppe (vp ändras inte) → skrolla ändå.
  useEffect(() => {
    const onFocus = () => setTimeout(scrollActiveIntoView, 300);
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  // När skalet fått ny höjd (tangentbord upp) är layouten klar → skrolla fram fältet.
  useEffect(() => {
    if (vp) scrollActiveIntoView();
  }, [vp]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-start overflow-y-auto bg-surface-gradient px-4 pb-24",
        vp
          ? "fixed left-0 right-0 z-50 pt-6"
          : "min-h-[100dvh] mt-[calc(env(safe-area-inset-top)*-1)] pt-[calc(env(safe-area-inset-top)+1.5rem)]"
      )}
      style={vp ? { top: vp.top, height: vp.height } : undefined}
    >
      {children}
    </div>
  );
}
