"use client";

import { useEffect } from "react";
import { isSwipeBackDestination, normalizeSwipePathname } from "@/lib/swipe-back-routes";

interface RouteSwipeSnapshot {
  destination: string;
  shell: HTMLElement;
  scrollY: number;
}

const SNAPSHOT_KEY = "__foilioRouteSwipeSnapshot";
type SwipeWindow = Window & { [SNAPSHOT_KEY]?: RouteSwipeSnapshot };

function swipeDestination(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const pathname = normalizeSwipePathname(url.pathname);
  return isSwipeBackDestination(pathname) ? pathname : null;
}

function rememberRoute(target: EventTarget | null) {
  const destination = swipeDestination(target);
  const shell = document.querySelector<HTMLElement>("[data-route-swipe-shell]");
  if (!destination || !shell) return;

  // ⛔ Klonen är BARA en visuell bakgrund för bakåtgesten. Den kopplas loss från
  // React och gör därför inga nya API-/DB-anrop, startar inga effekter och får
  // aldrig vara interaktiv. En iframe eller dold andra render hade dubblat
  // sidans läsningar och kunnat väcka Neon igen.
  const clone = shell.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("data-route-swipe-snapshot", "");
  // Produkt-overlayn flyttar samma skal med inline-transform. Om en länk i
  // overlayn går vidare till en SwipeBack-rutt får klonen inte ärva det
  // tillfälliga -18 %-läget och sedan parallaxas en gång till.
  clone.style.transform = "";
  clone.style.transition = "";
  clone.style.willChange = "";
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  // En kedja som grupp → tråd eller tråd → profil får inte bädda in den förra
  // bakgrunden igen. Det hade vuxit DOM-kopian för varje navigeringsled.
  clone.querySelectorAll("[data-swipe-back-underlay]").forEach((node) => node.remove());
  (window as SwipeWindow)[SNAPSHOT_KEY] = {
    destination,
    shell: clone,
    scrollY: window.scrollY,
  };
}

/**
 * Sparar den redan målade vyn precis innan en länk öppnar en SwipeBack-rutt.
 * Bara touch-enheter gör arbetet; desktop har ingen kantgest som kan visa den.
 */
export function RouteSwipeSnapshotCapture() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints === 0) return;

    const onPointerDown = (event: PointerEvent) => rememberRoute(event.target);
    const onClick = (event: MouseEvent) => {
      // Tangentbordsaktiverade länkar saknar pointerdown. Vanliga klick fångades
      // redan där, så vi slipper klona en stor sida två gånger.
      if (event.detail === 0) rememberRoute(event.target);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}

/** Hämtar bakgrunden. Anroparen klonar den så React Strict Modes effektprov är idempotent. */
export function getRouteSwipeSnapshot(pathname: string): RouteSwipeSnapshot | null {
  const pendingSnapshot = (window as SwipeWindow)[SNAPSHOT_KEY];
  if (!pendingSnapshot || pendingSnapshot.destination !== normalizeSwipePathname(pathname)) return null;
  return pendingSnapshot;
}
