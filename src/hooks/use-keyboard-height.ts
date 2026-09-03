"use client";

import { useEffect, useState } from "react";

/**
 * Tangentbordets höjd i px (0 = nere) — DEN ENDA mätningen; delas av
 * ui/bottom-sheet.tsx, ui/modal.tsx och chattens conversation-screen.tsx.
 *
 * Native-appen kör `Keyboard resize: none`, så varken WKWebView:en eller
 * window.visualViewport krymper när tangentbordet öppnas — Capacitor Keyboard-
 * pluginet (via window.Capacitor-bryggan; den bundlade @capacitor-importen är
 * undefined i den hostade webben, se push-client) är enda pålitliga signalen.
 * På webb/PWA finns ingen brygga → visualViewport (krymper där).
 *
 * `active` = false ⇒ inga lyssnare och 0 (arket/modalen stängd).
 */
export function useKeyboardHeight(active: boolean): number {
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    if (!active) return;
    const cleanups: (() => void)[] = [];
    const kb = (globalThis as { Capacitor?: { Plugins?: { Keyboard?: any } } }).Capacitor?.Plugins
      ?.Keyboard;
    if (kb?.addListener) {
      const add = (ev: string, fn: (i: any) => void) => {
        const p = kb.addListener(ev, fn);
        Promise.resolve(p)
          .then((h: any) => cleanups.push(() => h?.remove?.()))
          .catch(() => {});
      };
      add("keyboardWillShow", (i: { keyboardHeight?: number }) =>
        setKbHeight(i?.keyboardHeight ?? 0)
      );
      add("keyboardWillHide", () => setKbHeight(0));
    } else if (typeof window !== "undefined" && window.visualViewport) {
      const vp = window.visualViewport;
      const update = () =>
        setKbHeight(Math.max(0, window.innerHeight - vp.height - vp.offsetTop));
      vp.addEventListener("resize", update);
      vp.addEventListener("scroll", update);
      update();
      cleanups.push(() => {
        vp.removeEventListener("resize", update);
        vp.removeEventListener("scroll", update);
      });
    }
    return () => {
      cleanups.forEach((c) => c());
      setKbHeight(0);
    };
  }, [active]);

  return kbHeight;
}
