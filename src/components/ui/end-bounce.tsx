"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * En liten, lokal slutstuds för långa läsytor. Roten har medvetet ingen native
 * rubber-band (den kan dra hela WebView:n); här ger vi bara innehållet en kort
 * 16 px rörelse uppåt när läsaren fortsätter förbi slutet.
 */
export function EndBounce({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let offset = 0;
    let active = false;

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
      el.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translateY(0px)";
      window.setTimeout(() => {
        el.style.transition = "";
        el.style.transform = "";
      }, 200);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 1) startY = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const dy = event.touches[0].clientY - startY;
      const host = scrollHost();
      const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 1;
      if (!atBottom || dy >= 0) return;
      event.preventDefault();
      active = true;
      offset = Math.max(-16, dy / 5);
      el.style.transition = "none";
      el.style.transform = `translateY(${offset}px)`;
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

  return <div ref={ref} className={cn("will-change-transform", className)}>{children}</div>;
}
