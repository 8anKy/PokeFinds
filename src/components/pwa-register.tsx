"use client";

import { useEffect } from "react";

/**
 * Service workern är BORTTAGEN (2026-06-29). Den cachade resurser och orsakade
 * upprepade reload-loopar ("flimmer") i Capacitor-WebView:en efter deployer, utan
 * att ge något värde för den native appen (alltid online). I stället AVREGISTRERAR
 * vi alla kvarvarande SW:ar och rensar cachar så stuck:ade enheter självläker.
 * (Behåller overscroll-handlern nedan.)
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => void r.unregister()))
      .catch(() => {});
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((keys) => keys.forEach((k) => void caches.delete(k)))
        .catch(() => {});
    }
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
