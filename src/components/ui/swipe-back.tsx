"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EDGE_ZONE_PX, lockAxis, resolveBackSwipe } from "@/lib/swipe-gesture";
import { getRouteSwipeSnapshot } from "@/components/layout/route-swipe-snapshot";
import {
  PAGE_ENTER_DURATION_MS,
  pageMotionTransition,
  swipeSettleDuration,
} from "@/lib/page-motion";

/**
 * Kant-svep tillbaka för RIKTIGA rutter som ligger "ovanpå" en föregående vy:
 * tråd, grupp, profil, sparade och setdetalj. Samma känsla som produkt-overlayns stäng-svep — sidan
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
  coverViewport = false,
}: {
  fallback: string;
  children: ReactNode;
  className?: string;
  /** Helsidesdetaljer (t.ex. samtal) måste även dra med safe-area + huvud. */
  coverViewport?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const underlayRef = useRef<HTMLDivElement>(null);
  const hasUnderlayRef = useRef(false);
  const finishEnterRef = useRef<() => void>(() => {});
  const goBackRef = useRef(() => {});
  goBackRef.current = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(fallback);
  };

  useLayoutEffect(() => {
    const underlay = underlayRef.current;
    const content = contentRef.current;
    if (!underlay || !content) return;
    const snapshot = getRouteSwipeSnapshot(pathname);
    if (!snapshot) return;

    const scroll = document.createElement("div");
    scroll.style.transform = `translateY(-${snapshot.scrollY}px)`;
    // Effektens setup/cleanup körs två gånger i React Strict Mode. Klona därför
    // den sparade noden här också; att flytta originalet hade lämnat andra
    // setup-varvet utan bakgrund och gjort felet osynligt bara i produktion.
    scroll.appendChild(snapshot.shell.cloneNode(true));
    underlay.appendChild(scroll);
    hasUnderlayRef.current = true;

    let firstFrame = 0;
    let secondFrame = 0;
    let finishTimer = 0;
    const finishEnter = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(finishTimer);
      underlay.style.display = "none";
      content.style.transition = "none";
      content.style.transform = "";
      content.style.position = "";
      content.style.zIndex = "";
      content.style.minHeight = "";
      content.style.borderTopLeftRadius = "";
      content.style.borderBottomLeftRadius = "";
      content.style.overflow = "";
      content.style.boxShadow = "";
      finishEnterRef.current = () => {};
    };
    finishEnterRef.current = finishEnter;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduceMotion) {
      // Den sparade sidan står still. Att också flytta den under fingret gjorde
      // att WebView behövde composita två hela sidor samtidigt och gav en tung
      // start på exakt samma sätt som den äldre produktgesten gjorde.
      underlay.style.display = "block";
      content.style.transition = "none";
      content.style.transform = "translateX(100%)";
      content.style.position = coverViewport ? "fixed" : "relative";
      content.style.zIndex = "1";
      content.style.minHeight = `${window.innerHeight}px`;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          const transform = pageMotionTransition("transform", PAGE_ENTER_DURATION_MS);
          content.style.transition = transform;
          content.style.transform = "translateX(0px)";
          finishTimer = window.setTimeout(finishEnter, PAGE_ENTER_DURATION_MS + 20);
        });
      });
    }

    return () => {
      finishEnter();
      hasUnderlayRef.current = false;
      underlay.replaceChildren();
    };
  }, [pathname, coverViewport]);

  useEffect(() => {
    const el = contentRef.current;
    const underlay = underlayRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const revealUnderlay = () => {
      if (!hasUnderlayRef.current || !underlay) return;
      underlay.style.display = "block";
      el.style.position = coverViewport ? "fixed" : "relative";
      el.style.zIndex = "1";
      // ⛔ Innehållssidorna har normalt transparent bakgrund eftersom marketing-
      // skalet målar svart bakom dem. När den förra vyn ligger MELLAN skalet och
      // den nya måste den nya sidans egen yta vara ogenomskinlig, annars syns båda
      // sidornas text ovanpå varandra. Minhöjden täcker även en kort sida.
      el.style.minHeight = `${window.innerHeight}px`;
    };

    const roundLeadingEdge = () => {
      // Den rundade framkanten ger detaljen en synlig, mjuk separation från
      // den stillastående sidan bakom utan en extra animerad yta.
      el.style.borderTopLeftRadius = "20px";
      el.style.borderBottomLeftRadius = "20px";
      el.style.overflow = "hidden";
      el.style.boxShadow = "-8px 0 24px rgb(0 0 0 / 0.22)";
    };

    const hideUnderlay = () => {
      if (underlay) underlay.style.display = "none";
      el.style.position = "";
      el.style.zIndex = "";
      el.style.minHeight = "";
      el.style.borderTopLeftRadius = "";
      el.style.borderBottomLeftRadius = "";
      el.style.overflow = "";
      el.style.boxShadow = "";
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE_PX) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-swipe-ignore]")) return;
      // Om användaren hinner ta tag i sidan under öppningsanimationen lämnas
      // kontrollen direkt till fingret från ett rent, stabilt grundläge.
      finishEnterRef.current();
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
        roundLeadingEdge();
      }
      e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translateX(${dx}px)`;
    };

    const springBack = () => {
      const width = el.offsetWidth || 1;
      const duration = reduceMotion ? 0 : swipeSettleDuration(dx / width, false);
      el.style.transition = reduceMotion ? "none" : pageMotionTransition("transform", duration);
      el.style.transform = "translateX(0px)";
      window.setTimeout(() => {
        el.style.transition = "none";
        el.style.transform = "";
        hideUnderlay();
      }, duration + 20);
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
        const duration = swipeSettleDuration(dx / width, true);
        el.style.transition = pageMotionTransition("transform", duration);
        el.style.transform = `translateX(${width}px)`;
        window.setTimeout(() => goBackRef.current(), duration);
        return;
      }
      springBack();
    };

    const onCancel = () => {
      if (!dragging) return;
      dragging = false;
      // ⛔ OS:et kan avbryta touchen vid t.ex. en systemgest eller notis. Ett
      // touchcancel är aldrig ett godkänt släpp och får därför inte råka
      // navigera bakåt bara för att hastigheten hann passera tröskeln.
      if (axis === "x") springBack();
      else {
        el.style.transform = "";
        hideUnderlay();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [coverViewport]);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={underlayRef}
        data-swipe-back-underlay
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 top-[env(safe-area-inset-top)] z-0 hidden overflow-hidden bg-surface"
      />
      <div
        ref={contentRef}
        className={cn(
          "bg-surface will-change-transform",
          // `fixed` lämnar dokumentets body-padding bakom sig. Helsidesytan
          // måste därför själv ta över både statusfältets inset och AppShells
          // vanliga py-6, annars hamnar samtalshuvudet under Dynamic Island.
          coverViewport && "fixed inset-0 z-30 pt-[calc(env(safe-area-inset-top)+1.5rem)] lg:static lg:z-auto lg:pt-0"
        )}
      >
        {children}
      </div>
    </div>
  );
}
