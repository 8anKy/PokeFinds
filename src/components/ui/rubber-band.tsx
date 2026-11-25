"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * GUMMIBAND (rubber banding) FÖR EN SIDA SOM SCROLLAR I DOKUMENTET — PROV på
 * Mer-fliken (ägaren 2026-11-25).
 *
 * Den inbyggda studsen är avstängd i hela appen (`overscroll-behavior: none` på
 * html + studsvakten i pwa-register.tsx): den flyttade HELA dokumentet, även
 * sidhuvudet och flikraden. Det här flyttar bara sidans INNEHÅLL — huvudet och
 * flikarna står still, som en scrollvy i en native app — och fungerar utan nytt
 * appbygge på både iPhone och Android.
 *
 * Två delar:
 *  1. Fingret drar förbi en kant ⇒ innehållet följer med avtagande utväxling
 *     och fjädrar tillbaka när fingret släpper.
 *  2. Ett kast som når kanten med fart ⇒ en kort studs.
 *
 * ⛔ Bara lodrätt: axeln avgörs innan något avbryts (samma läxa som studsvakten —
 * `preventDefault()` dödar annars sidledssvepen mellan flikarna).
 */

const AXIS_PX = 6;
/** Samma konstant som iOS använder i sin scrollvy. */
const STIFFNESS = 0.55;
const SPRING = "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)";
/** Ytor som äger sitt eget drag eller ligger ovanpå sidan. */
const FOREIGN = '[data-drag-surface], [role="dialog"], [aria-modal="true"]';

/** Dragsträcka → förskjutning: följer fingret först, planar ut mot `dim`. */
export function rubberBand(distance: number, dim: number): number {
  return (1 - 1 / ((distance * STIFFNESS) / dim + 1)) * dim;
}

/** Inversen — så ett finger som fångar bandet mitt i fjädringen tar över utan hopp. */
export function rubberBandInverse(offset: number, dim: number): number {
  const b = Math.min(offset, dim * 0.95);
  return ((1 / (1 - b / dim) - 1) * dim) / STIFFNESS;
}

export function RubberBand({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bara pekskärm: ett mushjul som studsar är inte en app-känsla, det är ett fel.
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let axis: "x" | "y" | null = null;
    let active = false; // gesten började på sidan, inte på ett ark ovanpå den
    let touching = false;
    /** 1 = innehållet draget nedåt (toppkanten), -1 = uppåt (bottenkanten). */
    let pull: -1 | 0 | 1 = 0;
    let anchorY = 0;
    let carried = 0;
    /** Vi har avbrutit gesten ⇒ webbläsaren scrollar inte längre åt oss. */
    let owned = false;
    let bounce: Animation | null = null;

    const atTop = () => window.scrollY <= 0;
    const atBottom = () =>
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    const shift = (y: number) => {
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
    };

    const onStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      active = e.touches.length === 1 && !target?.closest?.(FOREIGN);
      if (!active) return;
      touching = true;
      // Fånga bandet där det ÄR (mitt i en fjädring eller studs), inte där det ska.
      const y = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
      bounce?.cancel();
      bounce = null;
      el.style.transition = "none";
      shift(y);
      startX = e.touches[0].clientX;
      startY = lastY = e.touches[0].clientY;
      axis = null;
      owned = false;
      pull = y > 0.5 ? 1 : y < -0.5 ? -1 : 0;
      anchorY = startY;
      carried = pull ? rubberBandInverse(Math.abs(y), window.innerHeight) : 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return;
      const t = e.touches[0];
      const y = t.clientY;
      const step = y - lastY;
      lastY = y;
      if (axis === null) {
        const dx = t.clientX - startX;
        const dy = y - startY;
        if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis === "x") return;

      if (!pull) {
        if (step > 0 && atTop()) pull = 1;
        else if (step < 0 && atBottom()) pull = -1;
        else {
          // Gesten är vår sedan ett tidigare drag: scrolla själva, annars står
          // sidan still tills fingret lyfts.
          if (owned) window.scrollBy({ top: -step, behavior: "instant" });
          return;
        }
        anchorY = y - step;
        carried = 0;
      }

      const distance = (y - anchorY) * pull + carried;
      if (distance <= 0) {
        pull = 0;
        shift(0);
        return;
      }
      if (e.cancelable) {
        e.preventDefault();
        owned = true;
      }
      shift(pull * rubberBand(distance, window.innerHeight));
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      touching = false;
      active = false;
      pull = 0;
      if (!el.style.transform) {
        el.style.transition = "";
        return;
      }
      el.style.transition = SPRING;
      shift(0);
    };

    const onSettled = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "transform") el.style.transition = "";
    };

    // Kastet: farten mäts ur scroll-händelserna. Ett enstaka hopp (ruttbyte,
    // scrollTo) är ingen ström och studsar inte.
    let prevY = window.scrollY;
    let prevT = performance.now();
    let speed = 0;
    let streak = 0;
    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY;
      const dt = now - prevT;
      const current = dt > 0 ? (y - prevY) / dt : 0;
      streak = dt < 120 ? streak + 1 : 0;
      // Sista steget före kanten är avklippt ⇒ ta det snabbaste av de två senaste.
      const peak = Math.abs(current) > Math.abs(speed) ? current : speed;
      speed = current;
      prevY = y;
      prevT = now;
      if (touching || bounce || streak < 3 || Math.abs(peak) < 0.4) return;
      const dir = peak < 0 && atTop() ? 1 : peak > 0 && atBottom() ? -1 : 0;
      if (!dir) return;
      const amplitude = dir * Math.min(Math.abs(peak) * 22, 64);
      streak = 0;
      const animation = el.animate(
        [
          { transform: "translate3d(0, 0, 0)", easing: "cubic-bezier(0, 0, 0.2, 1)" },
          { transform: `translate3d(0, ${amplitude}px, 0)`, offset: 0.28, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 560 }
      );
      bounce = animation;
      const clear = () => {
        if (bounce === animation) bounce = null;
      };
      animation.onfinish = clear;
      animation.oncancel = clear;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("transitionend", onSettled);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("transitionend", onSettled);
      bounce?.cancel();
      el.style.transition = "";
      el.style.transform = "";
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
