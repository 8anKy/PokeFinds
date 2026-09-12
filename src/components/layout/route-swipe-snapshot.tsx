"use client";

import { useEffect } from "react";
import { isSwipeBackDestination, normalizeSwipePathname } from "@/lib/swipe-back-routes";

interface RouteSwipeSnapshot {
  destination: string;
  shell: HTMLElement;
  /** Skalets faktiska viewport-läge när länken trycktes. */
  top: number;
  /** Skannerns egen underlay använder fortfarande dokumentets scroll-läge. */
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

/** Sparar nuvarande skal inför en programmatisk navigering till detaljvyn. */
export function captureRouteSwipeSnapshot(destination: string) {
  const normalizedDestination = normalizeSwipePathname(destination);
  const shell = document.querySelector<HTMLElement>("[data-route-swipe-shell]");
  if (!isSwipeBackDestination(normalizedDestination) || !shell) return;

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
    destination: normalizedDestination,
    shell: clone,
    // ⛔ Mät positionen, inte bara window.scrollY. AppShell, marketing och
    // body:s safe-area-padding börjar på olika höjd; ett eget scroll-avdrag
    // gjorde att den klonade vyn hoppade ned eller lämnade en svart toppremsa.
    top: shell.getBoundingClientRect().top,
    scrollY: window.scrollY,
  };
}

function rememberRoute(target: EventTarget | null) {
  const destination = swipeDestination(target);
  if (destination) captureRouteSwipeSnapshot(destination);
}

/**
 * Sparar den redan målade vyn precis innan en länk öppnar en SwipeBack-rutt.
 * Bara touch-enheter gör arbetet; desktop har ingen kantgest som kan visa den.
 */
export function RouteSwipeSnapshotCapture() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints === 0) return;

    const onPointerDown = (event: PointerEvent) => rememberRoute(event.target);
    // WKWebView levererar touchstart före en del av sina pointer-events när en
    // Link navigerar samma bildruta. Spara därför här också; annars hann ruttbytet
    // ibland före kopian och bakåtsvepet avslöjade bara en svart yta.
    const onTouchStart = (event: TouchEvent) => rememberRoute(event.target);
    const onClick = (event: MouseEvent) => {
      // Tangentbordsaktiverade länkar saknar pointerdown. Vanliga klick fångades
      // redan där, så vi slipper klona en stor sida två gånger.
      if (event.detail === 0) rememberRoute(event.target);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("touchstart", onTouchStart, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("touchstart", onTouchStart, true);
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

/**
 * Förbrukar bakgrunden när dess inglidning spelats. ⛔ Utan det låg kopian kvar
 * i fönstret och spelade om inglidningen varje gång pathname blev densamma
 * igen — flödets flikbyte (replaceState /evenemang → /nyheter) "svepte" in
 * Senaste nytt i stället för att tona (2026-09-12). Bara SAMMA objekt tas
 * bort, så en nyare kopia från ett senare tryck aldrig raderas av misstag.
 */
export function consumeRouteSwipeSnapshot(snapshot: RouteSwipeSnapshot) {
  const w = window as SwipeWindow;
  if (w[SNAPSHOT_KEY] === snapshot) delete w[SNAPSHOT_KEY];
}

export function hasPendingRouteSwipeSnapshot(): boolean {
  return Boolean((window as SwipeWindow)[SNAPSHOT_KEY]);
}
