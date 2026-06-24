"use client";

import { useEffect } from "react";

/**
 * Registrerar service workern (/sw.js) så appen blir installerbar och
 * offline-tålig. Endast i produktion — i dev stör en SW HMR/cache.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // registreringsfel ska aldrig krascha appen
    });
  }, []);

  useEffect(() => {
    // iOS WKWebView studsar HELA dokumentet förbi toppen (rubber-band) trots
    // native scrollView.bounces=false. Blockera nedåt-drag BARA när sidan redan
    // är i topp; tillåt nästlade scrollers som har plats kvar. Gate:ade förut på
    // window.Capacitor men den finns INTE på remote-laddade sidor (server.url) →
    // körs nu överallt (overscroll-behavior:none är ändå globalt önskat).
    let startY = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY; };
    const onMove = (e: TouchEvent) => {
      if (window.scrollY > 0) return;             // inte i topp → normal scroll
      if (e.touches[0].clientY <= startY) return; // drar uppåt → normal scroll
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) return; // nästlad scroller har plats
        el = el.parentElement;
      }
      e.preventDefault();                         // i topp + drar nedåt → blockera studs
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, []);

  return null;
}
