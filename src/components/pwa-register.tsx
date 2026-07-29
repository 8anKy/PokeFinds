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
    let startX = 0;
    let startY = 0;
    let axis: "x" | "y" | null = null;
    const AXIS_THRESHOLD = 6; // px innan gesten går att klassa
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = null;
    };
    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      // ⛔ AXELN MÅSTE AVGÖRAS FÖRST. `preventDefault()` avbryter HELA gesten, inte
      // bara dess lodräta del — utan det här testet dödade studsvakten varenda
      // VÅGRÄT dragning som råkade ske högst upp på sidan (scrollY === 0) med ett
      // finger som drev några pixlar nedåt. Det slog ut både filtrens chip-rad
      // ("känner inte alltid av att jag sveper") och prisreglaget ("stannar när
      // tummen hamnar under reglaget") — samma bugg, två symtom. Vågrätt drag är
      // aldrig en studs; låt det gå.
      if (axis === null) {
        if (Math.abs(dx) < AXIS_THRESHOLD && Math.abs(dy) < AXIS_THRESHOLD) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis === "x") return;
      if (window.scrollY > 0) return; // inte i topp → normal scroll
      if (dy <= 0) return;            // drar uppåt → normal scroll
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        // Kontroller som äger sitt eget drag (reglage) rörs inte.
        if (el instanceof HTMLInputElement && el.type === "range") return;
        if (el.scrollWidth > el.clientWidth) return;                       // sidledsscroller
        if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) return; // nästlad scroller har plats
        el = el.parentElement;
      }
      e.preventDefault(); // i topp + drar nedåt → blockera studs
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
