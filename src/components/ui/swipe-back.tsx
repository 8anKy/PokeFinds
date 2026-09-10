"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EDGE_ZONE_PX, lockAxis, resolveBackSwipe } from "@/lib/swipe-gesture";
import { getForumSwipeSnapshot } from "@/components/layout/forum-swipe-snapshot";

/**
 * Kant-svep tillbaka för RIKTIGA rutter som ligger "ovanpå" forumet: tråd,
 * grupp, profil, sparade. Samma känsla som produkt-overlayns stäng-svep — sidan
 * följer fingret från vänsterkanten och glider ut när svepet passerar tröskeln
 * (lib/swipe-gesture). Bakåt = webbläsarhistoriken (router.back), utan historik
 * (djuplänk) landar vi på `fallback` — samma regel som BackCircle (ui/back-circle).
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
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const underlayMotionRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const hasUnderlayRef = useRef(false);
  const goBackRef = useRef(() => {});
  goBackRef.current = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(fallback);
  };

  useEffect(() => {
    const underlay = underlayRef.current;
    const motion = underlayMotionRef.current;
    if (!underlay || !motion) return;
    const snapshot = getForumSwipeSnapshot(pathname);
    if (!snapshot) return;

    const scroll = document.createElement("div");
    scroll.style.transform = `translateY(-${snapshot.scrollY}px)`;
    // Effektens setup/cleanup körs två gånger i React Strict Mode. Klona därför
    // den sparade noden här också; att flytta originalet hade lämnat andra
    // setup-varvet utan bakgrund och gjort felet osynligt bara i produktion.
    scroll.appendChild(snapshot.shell.cloneNode(true));
    motion.appendChild(scroll);
    hasUnderlayRef.current = true;
    return () => {
      hasUnderlayRef.current = false;
      motion.replaceChildren();
    };
  }, [pathname]);

  useEffect(() => {
    const el = contentRef.current;
    const underlay = underlayRef.current;
    const underlayMotion = underlayMotionRef.current;
    const shade = shadeRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const revealUnderlay = () => {
      if (!hasUnderlayRef.current || !underlay || !underlayMotion || !shade) return;
      underlay.style.display = "block";
      underlayMotion.style.transition = "none";
      underlayMotion.style.transform = "translateX(-18%)";
      shade.style.transition = "none";
      shade.style.opacity = "0.2";
      el.style.position = "relative";
      el.style.zIndex = "1";
      // ⛔ Innehållssidorna har normalt transparent bakgrund eftersom marketing-
      // skalet målar svart bakom dem. När forumklonen ligger MELLAN skalet och
      // tråden måste trådens egen yta vara ogenomskinlig, annars syns båda sidornas
      // text ovanpå varandra under hela svepet. Minhöjden täcker även en kort tråd.
      el.style.minHeight = `${window.innerHeight}px`;
    };

    const moveUnderlay = (distance: number, width: number) => {
      if (!hasUnderlayRef.current || !underlayMotion || !shade) return;
      const progress = Math.min(1, distance / width);
      underlayMotion.style.transform = `translateX(${-18 * (1 - progress)}%)`;
      shade.style.opacity = `${0.2 * (1 - progress)}`;
    };

    const hideUnderlay = () => {
      if (underlay) underlay.style.display = "none";
      if (underlayMotion) {
        underlayMotion.style.transition = "none";
        underlayMotion.style.transform = "";
      }
      if (shade) {
        shade.style.transition = "none";
        shade.style.opacity = "";
      }
      el.style.position = "";
      el.style.zIndex = "";
      el.style.minHeight = "";
    };

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
        revealUnderlay();
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
      moveUnderlay(dx, el.offsetWidth || 1);
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        hideUnderlay();
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
        if (hasUnderlayRef.current && underlayMotion && shade) {
          underlayMotion.style.transition = "transform 0.22s ease";
          underlayMotion.style.transform = "translateX(0%)";
          shade.style.transition = "opacity 0.22s ease";
          shade.style.opacity = "0";
        }
        window.setTimeout(() => goBackRef.current(), 200);
        return;
      }
      el.style.transition = reduceMotion ? "none" : "transform 0.25s ease";
      el.style.transform = "translateX(0px)";
      if (hasUnderlayRef.current && underlayMotion && shade) {
        underlayMotion.style.transition = reduceMotion ? "none" : "transform 0.25s ease";
        underlayMotion.style.transform = "translateX(-18%)";
        shade.style.transition = reduceMotion ? "none" : "opacity 0.25s ease";
        shade.style.opacity = "0.2";
      }
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.transform = "";
        hideUnderlay();
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
    <div className={cn("relative", className)}>
      <div
        ref={underlayRef}
        data-swipe-back-underlay
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 top-[env(safe-area-inset-top)] z-0 hidden overflow-hidden bg-surface"
      >
        <div ref={underlayMotionRef} className="absolute inset-0 will-change-transform" />
        <div ref={shadeRef} className="absolute inset-0 bg-black" />
      </div>
      <div ref={contentRef} className="bg-surface will-change-transform">
        {children}
      </div>
    </div>
  );
}
