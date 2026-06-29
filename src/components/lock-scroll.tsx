"use client";

import { useEffect } from "react";

// ponytail: lås body-scroll på sidor vars innehåll får plats (Mer/Community) så
// de inte går att studsa/scrolla när det inte finns något under viken. Klipper
// bara den tomma svansen; återställs när man navigerar bort.
export function LockScroll() {
  useEffect(() => {
    // Scroll-container är <html> (se globals.css), inte body → lås båda.
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);
  return null;
}
