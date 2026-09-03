"use client";

import { useEffect, useState } from "react";

/**
 * Tangentbordets höjd i px (0 = nere). SAMMA mätning som ui/bottom-sheet.tsx
 * och ui/modal.tsx: native-appen kör `Keyboard resize: none`, så varken
 * WKWebView:en eller visualViewport krymper där — Capacitor-bryggan är enda
 * pålitliga signalen. På webb/PWA finns ingen brygga → visualViewport.
 *
 * ⚠️ Tredje kopian av mätningen (ark, modal, chatt). Nästa pass som rör
 * arket eller modalen bör lyfta ut den här hooken till lib och låta alla tre
 * dela den — de två andra filerna ägs inte av chatt-bygget.
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
