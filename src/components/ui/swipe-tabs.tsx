"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EDGE_ZONE_PX, lockAxis, resolveTabSwipe, rubberBand } from "@/lib/swipe-gesture";

export interface SwipeTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Flikar man kan svepa mellan (profilen, sparade trådar). Flikraden är vanliga
 * knappar; panelerna ligger på ett spår som följer fingret och glider till
 * grannfliken när svepet passerar tröskeln (lib/swipe-gesture).
 *
 * LAYOUT: bara den aktiva panelen ligger i flödet (den sätter höjden); grannarna
 * är absolut placerade vid ±100 % och klipps av containern. Så blir en kort
 * flik (ett inlägg) aldrig lika hög som en lång (tolv Tradera-rutor), men
 * grannen syns ändå glida in under draget. Höjden hoppar i bytesögonblicket —
 * det är med flit hellre än en mätt/animerad höjd.
 *
 * GESTEN: touch-events (inte pointer) och preventDefault på vågrätt touchmove
 * av samma skäl som produkt-overlayn — i WKWebView tar systemets kant-svep
 * annars gesten. Kantzonen (EDGE_ZONE_PX från vänster) rörs INTE: den tillhör
 * SwipeBack, som kan ligga utanför. Ytor som äger sitt eget vågräta drag
 * markeras `data-swipe-ignore` (grupp-chips, filterrader).
 */
export function SwipeTabs({
  tabs,
  initialId,
  ariaLabel,
  className,
  onChange,
}: {
  tabs: SwipeTab[];
  initialId?: string;
  ariaLabel: string;
  className?: string;
  onChange?: (id: string) => void;
}) {
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((t) => t.id === initialId)
    )
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // Effekten nedan lever över hela monteringen; den läser alltid färskt läge via refs.
  const activeRef = useRef(active);
  activeRef.current = active;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function select(index: number) {
    const list = tabsRef.current;
    if (index < 0 || index >= list.length || index === activeRef.current) return;
    setActive(index);
    onChangeRef.current?.(list[index].id);
  }

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dx = 0;
    let dragging = false;
    let axis: "x" | "y" | null = null;

    const settle = (toPx: number, then?: () => void) => {
      const finish = () => {
        el.style.transition = "none";
        el.style.transform = "";
        then?.();
      };
      if (reduceMotion || toPx === 0) {
        finish();
        return;
      }
      el.style.transition = "transform 0.25s ease";
      el.style.transform = `translateX(${toPx}px)`;
      window.setTimeout(finish, 260);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE_ZONE_PX) return;
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
      const i = activeRef.current;
      const atEdge = (mx > 0 && i === 0) || (mx < 0 && i === tabsRef.current.length - 1);
      dx = atEdge ? rubberBand(mx) : mx;
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      if (axis !== "x") {
        el.style.transform = "";
        return;
      }
      const i = activeRef.current;
      const width = el.offsetWidth || 1;
      const dt = Math.max(1, e.timeStamp - startT);
      const dir = resolveTabSwipe({
        dx,
        width,
        velocityPxPerMs: dx / dt,
        canPrev: i > 0,
        canNext: i < tabsRef.current.length - 1,
      });
      if (dir === 0) {
        // Glid tillbaka till viloläget.
        el.style.transition = reduceMotion ? "none" : "transform 0.25s ease";
        el.style.transform = "translateX(0px)";
        window.setTimeout(() => {
          el.style.transition = "none";
          el.style.transform = "";
        }, 260);
        return;
      }
      // Grannen står vid ±100 %: glid dit, byt sedan aktiv panel (som då hamnar
      // i flödet vid 0 utan transform — samma bild, ingen hopp).
      settle(dir > 0 ? -width : width, () => select(i + dir));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="grid border-b border-surface-border"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = i === active;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(i)}
              className={cn(
                "-mb-px h-11 truncate border-b-2 px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-holo-cyan",
                isActive
                  ? "border-holo-cyan text-holo-cyan"
                  : "border-transparent text-ink-muted hover:text-ink"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* touch-action: pan-y → webbläsaren scrollar bara lodrätt själv; vågrätt är vårt. */}
      <div className="relative overflow-hidden" style={{ touchAction: "pan-y" }}>
        <div ref={trackRef} className="relative will-change-transform">
          {tabs.map((tab, i) => {
            const isActive = i === active;
            return (
              <section
                key={tab.id}
                id={`${baseId}-panel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`${baseId}-tab-${tab.id}`}
                aria-hidden={!isActive}
                className={cn("w-full pt-4", isActive ? "relative" : "absolute top-0")}
                style={isActive ? undefined : { left: `${(i - active) * 100}%` }}
              >
                {tab.content}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
