"use client";

import { useEffect } from "react";
import { track } from "@/lib/track";

/**
 * Global engagemangs-spårning för "list_click": en enda capture-fas-lyssnare på
 * document fångar ALLA klick på produktlänkar (/produkter/{slug}) — kort i feeds,
 * marknadsrader, liknande-produkter — utan att varje server-komponent behöver bli
 * klientkomponent. Fire-and-forget via sendBeacon; påverkar aldrig navigeringen.
 *
 * Sökförslag markeras `data-no-track` och skjuter istället "search_click" själva,
 * så samma klick inte dubbelräknas som både lista och sökning.
 */
function slugFromHref(href: string | null): string | null {
  if (!href) return null;
  let path = href;
  if (/^https?:\/\//.test(href)) {
    try {
      path = new URL(href).pathname;
    } catch {
      return null;
    }
  }
  // Valfritt locale-prefix (/en) framför — engelska URL:er är /en/produkter/...
  const m = path.match(/^(?:\/[a-z]{2})?\/produkter\/([^/?#]+)$/);
  return m ? m[1] : null;
}

export function EngagementTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.closest("[data-no-track]")) return; // sökförslag sköter sitt eget
      const slug = slugFromHref(anchor.getAttribute("href"));
      if (slug) track("list_click", slug);
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
