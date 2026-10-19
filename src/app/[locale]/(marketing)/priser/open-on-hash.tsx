"use client";

import { useEffect } from "react";

/**
 * "Jämför allt" (arket och sidans egen länk) pekar på `#jamfor` — öppna den hopfällda
 * jämförelsen och scrolla dit, både vid sidladdning och vid ett klick på sidan.
 */
export function OpenOnHash({ id }: { id: string }) {
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== `#${id}`) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [id]);
  return null;
}
