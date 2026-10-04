"use client";

/**
 * SPOTLIGHTEN — delad ritning för appens guidade turer (appturen i rot-layouten och
 * graderingsturen på /gradera). Ett mål markeras med en turkos ring, resten av
 * skärmen dämpas av fyra spärrytor RUNT målet och en bubbla förklarar.
 *
 * ⛔ Inte en ring med en jätteskugga (`box-shadow: 0 0 0 9999px`) — Chrome ritade den
 *    inte alls i mobilvyn (mätt 2026-09-23). Fyra rutor fungerar överallt.
 * ⛔ Målen är `data-tour`-ATTRIBUT, aldrig klasser (se lib/app-tour.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { bubblePlacement, type Rect } from "@/lib/app-tour";

/** Luft mellan målet och ringen. */
const PAD = 6;
const DIM = "pointer-events-auto absolute bg-black/65";

/** Första SYNLIGA elementet med `data-tour="<name>"` (mobil och desktop kan rendera båda). */
export function findTourTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * SIDAN STÅR STILL UNDER TUREN (ägarens fältrapport 2026-10-04: svep upp/ned fick
 * ringen och bubblan att släpa efter). Pek- och hjulscroll stoppas medan turen är
 * öppen; turens egen `scrollIntoView` är programmatisk och fungerar ändå.
 * ⛔ Inte `overflow: hidden` på body — LockScroll-läxan (ui-shell.md): två låsare
 *    återställer varandras sparade värde. Händelsen stoppas, inget stilvärde ändras.
 */
export function useBlockScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const stop = (e: Event) => e.preventDefault();
    const keys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    const stopKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (keys.has(e.key) && !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)))) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", stop, { passive: false });
    document.addEventListener("wheel", stop, { passive: false });
    document.addEventListener("keydown", stopKey);
    return () => {
      document.removeEventListener("touchmove", stop);
      document.removeEventListener("wheel", stop);
      document.removeEventListener("keydown", stopKey);
    };
  }, [active]);
}

/**
 * Följer målet: letar tills det finns, scrollar fram det en gång och mäter varje
 * bildruta (scroll, animationer). Dröjer det längre än `waitMs` anropas `onMissing`
 * — en mörk skärm utan hål och bubbla är värre än ett överhoppat steg.
 */
export function useTourTarget(target: string | null, onMissing: () => void, waitMs = 4_000): Rect | null {
  // Rutan bär sitt mål: vid stegbyte returneras null direkt (inte förra stegets ruta
  // med nya stegets text i en bildruta).
  const [state, setState] = useState<{ target: string; rect: Rect } | null>(null);
  const missing = useRef(onMissing);
  missing.current = onMissing;
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    let scrolled = false;
    const started = Date.now();
    const tick = () => {
      const el = findTourTarget(target);
      if (el) {
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          if (r.top < 60 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: "center" });
        }
        const r = el.getBoundingClientRect();
        setState((prev) =>
          prev &&
          prev.target === target &&
          prev.rect.top === r.top &&
          prev.rect.left === r.left &&
          prev.rect.width === r.width &&
          prev.rect.height === r.height
            ? prev
            : { target, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
        );
      } else if (Date.now() - started > waitMs) {
        missing.current();
        return;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [target, waitMs]);
  return state && state.target === target ? state.rect : null;
}

export function Spotlight(props: {
  rect: Rect;
  /** Info-steg: även hålet spärras — målet ska visas, inte tryckas. */
  blockTarget: boolean;
  label: string;
  /** Bubblans innehåll. */
  children: ReactNode;
}) {
  const { rect } = props;
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleSize, setBubbleSize] = useState({ width: 300, height: 150 });

  // Bubblans höjd byts med stegets text — mät om när innehållet byts (setState bara
  // vid ändring, så ingen loop).
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width !== bubbleSize.width || height !== bubbleSize.height) setBubbleSize({ width, height });
  }, [props.children, bubbleSize.width, bubbleSize.height]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const hole = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const place = bubblePlacement(hole, { width: vw, height: vh }, bubbleSize);

  return (
    // ⛔ Behållaren släpper igenom tryck (pointer-events-none) — annars fångar den
    //    trycket i HÅLET också och målet kan aldrig tryckas. Spärrytorna och bubblan
    //    slår på pointer-events själva.
    <div className="pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={props.label}>
      <div className={DIM} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className={DIM} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
      <div className={DIM} style={{ top: hole.top, height: hole.height, left: 0, width: Math.max(0, hole.left) }} />
      <div className={DIM} style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, right: 0 }} />
      {props.blockTarget && <div className="pointer-events-auto absolute" style={hole} />}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-xl ring-2 ring-holo-cyan motion-safe:animate-pulse"
        style={hole}
      />

      <div
        ref={bubbleRef}
        className="pointer-events-auto absolute w-[min(320px,calc(100vw-32px))] rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xl"
        style={{ top: Math.max(12, Math.min(vh - bubbleSize.height - 12, place.top)), left: place.left }}
      >
        <span
          aria-hidden
          className="absolute h-3 w-3 rotate-45 border-surface-border bg-surface-raised"
          style={
            place.side === "below"
              ? { top: -7, left: place.arrowLeft - 6, borderLeftWidth: 1, borderTopWidth: 1 }
              : { bottom: -7, left: place.arrowLeft - 6, borderRightWidth: 1, borderBottomWidth: 1 }
          }
        />
        {props.children}
      </div>
    </div>
  );
}
