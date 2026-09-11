"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { END_BOUNCE_EVENT, type EndBounceDetail } from "@/lib/end-bounce";
import { cn } from "@/lib/utils";

/**
 * En liten, lokal slutstuds för långa läsytor. Roten har medvetet ingen native
 * rubber-band (den kan dra hela WebView:n). I stället får marknadsföringsskalet
 * och den fasta flikraden röra sig tillsammans, precis som en liten lokal
 * slutstuds — aldrig hela WebView:n eller en enskild artikel ovanför flikarna.
 */
export function EndBounce({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let overscrollStartY: number | null = null;
    let active = false;
    const shell = el.closest<HTMLElement>("[data-marketing-shell]");
    const emit = (detail: EndBounceDetail) => {
      window.dispatchEvent(new CustomEvent<EndBounceDetail>(END_BOUNCE_EVENT, { detail }));
    };
    const moveSurface = (nextOffset: number, settling: boolean) => {
      if (!shell) return;
      shell.style.willChange = "transform";
      shell.style.transition = settling ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
      shell.style.transform = `translate3d(0, ${nextOffset}px, 0)`;
      emit({ offset: nextOffset, settling });
    };

    const scrollHost = () => {
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        if (node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== "visible") return node;
        node = node.parentElement;
      }
      return document.scrollingElement as HTMLElement;
    };
    const reset = () => {
      if (!active) return;
      active = false;
      moveSurface(0, true);
      window.setTimeout(() => {
        if (!shell) return;
        shell.style.willChange = "";
        shell.style.transition = "";
        shell.style.transform = "";
      }, 240);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        startY = event.touches[0].clientY;
        overscrollStartY = null;
      }
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touchY = event.touches[0].clientY;
      const dy = touchY - startY;
      const host = scrollHost();
      const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
      if (!atBottom || dy >= 0) {
        overscrollStartY = null;
        return;
      }
      event.preventDefault();
      // En lång scroll som precis når slutet ska börja studsa DÄR, inte hoppa
      // direkt till maxläget med hela dragets längd som underlag.
      if (overscrollStartY === null) overscrollStartY = touchY;
      active = true;
      // Referensrörelsen är ca 25 px på en telefon: tillräcklig respons utan
      // att sista kortet eller källraden försvinner bakom bottenflikarna.
      moveSurface(Math.max(-28, (touchY - overscrollStartY) / 4.8), false);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", reset);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", reset);
      el.removeEventListener("touchcancel", reset);
    };
  }, []);

  return <div ref={ref} className={className}>{children}</div>;
}
