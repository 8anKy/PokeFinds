"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Kör en bakåt-navigering (router.back / stäng-overlay) inuti webbläsarens
 * native View Transition så att destinationen GLIDER fram under den utgående
 * sidan — istället för en hård svart-svep. Slide-utseendet bor i globals.css
 * (`.vt-back::view-transition-old(root)`).
 *
 * Knepet: View Transitions vill att callbacken returnerar ett promise som
 * resolvar NÄR nya DOM:en är på plats. Next App Router-navigeringen är
 * asynkron → vi resolvar därför när `usePathname()` ändras (ny route monterad),
 * med en timeout som säkerhetsnät om navigeringen aldrig sker (t.ex. avbruten).
 */
export function useViewTransitionBack() {
  const pathname = usePathname();
  const finishRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    finishRef.current?.();
    finishRef.current = null;
  }, [pathname]);

  return useCallback((navigate: () => void) => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<unknown> };
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) {
      navigate();
      return;
    }
    document.documentElement.classList.add("vt-back");
    const vt = doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          finishRef.current = resolve;
          navigate();
          window.setTimeout(() => {
            finishRef.current?.();
            finishRef.current = null;
          }, 500);
        })
    );
    void vt.finished.finally(() =>
      document.documentElement.classList.remove("vt-back")
    );
  }, []);
}
