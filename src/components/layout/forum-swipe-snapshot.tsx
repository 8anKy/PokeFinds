"use client";

import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";

interface ForumSwipeSnapshot {
  destination: string;
  shell: HTMLElement;
  scrollY: number;
}

let pendingSnapshot: ForumSwipeSnapshot | null = null;

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
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  pendingSnapshot = {
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
    if (!isForumFeed(pathname)) return;
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

/** Flyttar ägarskapet till SwipeBack; samma klon används aldrig två gånger. */
export function takeForumSwipeSnapshot(pathname: string): ForumSwipeSnapshot | null {
  if (!pendingSnapshot || pendingSnapshot.destination !== withoutLocale(pathname)) return null;
  const snapshot = pendingSnapshot;
  pendingSnapshot = null;
  return snapshot;
}
