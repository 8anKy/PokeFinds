"use client";

import { useEffect } from "react";

// ponytail: lås body-scroll på sidor vars innehåll får plats (Mer/Community) så
// de inte går att studsa/scrolla när det inte finns något under viken. Klipper
// bara den tomma svansen; återställs när man navigerar bort.
export function LockScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return null;
}
