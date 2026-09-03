"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EDGE_ZONE_PX, lockAxis, resolveBackSwipe } from "@/lib/swipe-gesture";

/**
 * Kant-svep tillbaka för RIKTIGA rutter som ligger "ovanpå" forumet: tråd,
 * grupp, profil, sparade. Samma känsla som produkt-overlayns stäng-svep — sidan
 * följer fingret från vänsterkanten och glider ut när svepet passerar tröskeln
 * (lib/swipe-gesture). Bakåt = webbläsarhistoriken (router.back), utan historik
 * (djuplänk) landar vi på `fallback` — samma regel som PageBackButton.
 *
 * Bara svep som BÖRJAR i kantzonen (EDGE_ZONE_PX) räknas; övriga vågräta drag
 * tillhör det som ligger under (SwipeTabs, chips-rader, grafer). Ytor som äger
 * kanten själva markeras `data-swipe-ignore`.
 *
 * Touch-events + preventDefault på vågrätt touchmove: i WKWebView tar annars
 * systemets kant-gest svepet (produkt-overlayn lärde oss det). Appen har inte
 * `allowsBackForwardNavigationGestures` på, så det här är den enda bakåt-gesten.
 */
export function SwipeBack({
  fallback,
  children,
  className,
}: {
  fallback: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const goBackRef = useRef(() => {});
  goBackRef.current = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(fallback);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE_PX) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-swipe-ignore]")) return;
      dragging = true;
      axis = null;
      dx = 0;
      startX = t.clientX;
      startY = t.clientY;
      startT = e.timeStamp;
      el.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (axis === null) {
        axis = lockAxis(mx, my);
        if (axis === null) return;
        if (axis === "y") {
          dragging = false;
          return;
        }
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      const width = el.offsetWidth || 1;
      const dt = Math.max(1, e.timeStamp - startT);
      if (resolveBackSwipe({ dx, width, velocityPxPerMs: dx / dt })) {
        if (reduceMotion) {
          goBackRef.current();
          return;
        }
        el.style.transition = "transform 0.22s ease";
        el.style.transform = `translateX(${width}px)`;
        window.setTimeout(() => goBackRef.current(), 200);
        return;
      }
      el.style.transition = reduceMotion ? "none" : "transform 0.25s ease";
      el.style.transform = "translateX(0px)";
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.transform = "";
      }, 260);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div ref={ref} className={cn("will-change-transform", className)}>
      {children}
    </div>
  );
}
