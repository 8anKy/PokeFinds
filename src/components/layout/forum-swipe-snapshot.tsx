"use client";

import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";

interface ForumSwipeSnapshot {
  destination: string;
  shell: HTMLElement;
  scrollY: number;
}

const SNAPSHOT_KEY = "__foilioForumSwipeSnapshot";
type SwipeWindow = Window & { [SNAPSHOT_KEY]?: ForumSwipeSnapshot };

function withoutLocale(pathname: string): string {
  return pathname.replace(/^\/(?:sv|en)(?=\/|$)/, "") || "/";
}

function isForumFeed(pathname: string): boolean {
  return pathname === "/forum" || pathname.startsWith("/forum/g/");
}

function threadDestination(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const pathname = withoutLocale(url.pathname);
  return pathname.startsWith("/forum/t/") ? pathname : null;
}

function rememberForum(target: EventTarget | null) {
  const destination = threadDestination(target);
  const shell = document.querySelector<HTMLElement>("[data-marketing-shell]");
  if (!destination || !shell) return;

  // ⛔ Klonen är BARA en visuell bakgrund för bakåtgesten. Den kopplas loss från
  // React och gör därför inga nya API-/DB-anrop, startar inga effekter och får
  // aldrig vara interaktiv. En iframe eller dold andra render hade dubblat
  // forumsidans läsningar och kunnat väcka Neon igen.
  const clone = shell.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("data-forum-swipe-snapshot", "");
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  (window as SwipeWindow)[SNAPSHOT_KEY] = {
    destination,
    shell: clone,
    scrollY: window.scrollY,
  };
}

/**
 * Tar en DOM-bild av det redan målade forumet precis innan en tråd öppnas.
 * Bilden används bara under den interaktiva bakåtgesten och flyttas med fingret.
 */
export function ForumSwipeSnapshotCapture() {
  const pathname = usePathname();

  useEffect(() => {
    // next-intl lämnar normalt tillbaka vägen utan locale-prefix, men under en
    // kall klientstart kan routern först exponera den faktiska /sv|/en-vägen.
    // Samma normalisering som destinationsmatchningen gör fångsten stabil i båda.
    if (!isForumFeed(withoutLocale(pathname))) return;
    // Föregående tråds visuella lager behövs inte när forumet är aktivt igen.
    delete (window as SwipeWindow)[SNAPSHOT_KEY];
    // Mus/desktop har ingen touchgest att visa klonen i. Hoppa över arbetet där;
    // maxTouchPoints täcker WKWebView även om dess media query skulle avvika.
    if (!window.matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints === 0) return;

    const onPointerDown = (event: PointerEvent) => rememberForum(event.target);
    const onClick = (event: MouseEvent) => {
      // Tangentbordsaktiverade länkar saknar pointerdown. Vanliga klick fångades
      // redan där, så vi slipper klona den stora forumsidan två gånger.
      if (event.detail === 0) rememberForum(event.target);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [pathname]);

  return null;
}

/** Hämtar bakgrunden. Anroparen klonar den så React Strict Modes effektprov är idempotent. */
export function getForumSwipeSnapshot(pathname: string): ForumSwipeSnapshot | null {
  const swipeWindow = window as SwipeWindow;
  const pendingSnapshot = swipeWindow[SNAPSHOT_KEY];
  if (!pendingSnapshot || pendingSnapshot.destination !== withoutLocale(pathname)) return null;
  return pendingSnapshot;
}
