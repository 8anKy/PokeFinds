"use client";

import { useEffect, type RefObject } from "react";

/**
 * Nyp för att zooma ett foto DIREKT i flödet, utan att öppna det (ägarbeslut
 * 2026-10-09, "som Instagram"): två fingrar på bilden lyfter en kopia till ett
 * fast lager ovanför allt, kopian följer fingrarna (skala + panorering) och
 * fjädrar tillbaka när man släpper. Inget sparas, inget navigerar.
 *
 * ⛔ Lyssnarna är NATIVA och icke-passiva: Reacts onTouchMove är passiv och kan
 *    inte stoppa sidans scroll eller WebKits egen sidzoom (`gesturestart`).
 * ⛔ Ett finger rör vi aldrig — karusellens sidledsscroll och sidans lodräta
 *    scroll ska bete sig exakt som förut.
 */
const MAX_SCALE = 4;
const RETURN_MS = 220;

function distance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a: Touch, b: Touch) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

export function usePinchZoom(containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active: {
      source: HTMLImageElement;
      layer: HTMLDivElement;
      clone: HTMLImageElement;
      startDistance: number;
      startMid: { x: number; y: number };
    } | null = null;

    const finish = () => {
      const zoom = active;
      if (!zoom) return;
      active = null;
      zoom.clone.style.transition = `transform ${RETURN_MS}ms ease-out`;
      zoom.clone.style.transform = "translate(0px, 0px) scale(1)";
      zoom.layer.style.transition = `background-color ${RETURN_MS}ms ease-out`;
      zoom.layer.style.backgroundColor = "rgba(0,0,0,0)";
      window.setTimeout(() => {
        zoom.layer.remove();
        zoom.source.style.visibility = "";
      }, RETURN_MS);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || active) return;
      const target = (e.target as HTMLElement | null)?.closest?.("[data-pinch-slot]");
      const source = target?.querySelector("img");
      if (!source || !source.complete) return;
      e.preventDefault();
      const rect = source.getBoundingClientRect();
      const [a, b] = [e.touches[0], e.touches[1]];
      const mid = midpoint(a, b);

      const layer = document.createElement("div");
      layer.style.cssText = "position:fixed;inset:0;z-index:90;pointer-events:none;background-color:rgba(0,0,0,0)";
      const clone = document.createElement("img");
      clone.src = source.currentSrc || source.src;
      clone.alt = "";
      clone.style.cssText = [
        "position:absolute",
        `left:${rect.left}px`,
        `top:${rect.top}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        "object-fit:cover",
        `transform-origin:${mid.x - rect.left}px ${mid.y - rect.top}px`,
        "will-change:transform",
      ].join(";");
      layer.appendChild(clone);
      document.body.appendChild(layer);
      source.style.visibility = "hidden";
      active = { source, layer, clone, startDistance: Math.max(1, distance(a, b)), startMid: mid };
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      e.preventDefault();
      if (e.touches.length < 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const scale = Math.min(MAX_SCALE, Math.max(1, distance(a, b) / active.startDistance));
      const mid = midpoint(a, b);
      const dx = mid.x - active.startMid.x;
      const dy = mid.y - active.startMid.y;
      active.clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      // Bakgrunden mörknar med zoomen, som när bilden lyfts ur flödet.
      active.layer.style.backgroundColor = `rgba(0,0,0,${Math.min(0.75, (scale - 1) * 0.6)})`;
    };

    const onEnd = (e: TouchEvent) => {
      if (active && e.touches.length < 2) finish();
    };

    // Safari på webben: stoppa sidzoomen när gesten börjar på en bild.
    const onGesture = (e: Event) => e.preventDefault();

    container.addEventListener("touchstart", onStart, { passive: false });
    container.addEventListener("touchmove", onMove, { passive: false });
    container.addEventListener("touchend", onEnd);
    container.addEventListener("touchcancel", onEnd);
    container.addEventListener("gesturestart", onGesture);
    return () => {
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
      container.removeEventListener("touchcancel", onEnd);
      container.removeEventListener("gesturestart", onGesture);
      finish();
    };
  }, [containerRef]);
}
