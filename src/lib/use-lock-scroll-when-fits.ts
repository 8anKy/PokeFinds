"use client";

import { useEffect } from "react";

/**
 * Låser sidscroll BARA när hela innehållet får plats i viewporten → ingen
 * studs/svep upp-ner på korta sidor (t.ex. Bjud in), men sidor vars innehåll
 * växer förbi skärmen scrollar fortfarande som vanligt.
 *
 * Skiljer sig från LockScroll (ovillkorligt lås på sidor som ALLTID får plats).
 * Här kan höjden ändras (listan hämtas asynkront), så skicka in det som styr
 * höjden som `deps` → effekten mäter om när datan ändras. Medvetet UTAN
 * ResizeObserver: en observer som mäter innehåll medan vi själva ändrar
 * overflow kan hamna i en återkopplingsloop som fryser renderaren.
 *
 * html.scrollHeight speglar det fulla innehållet även när overflow är hidden, så
 * omätning medan låst är korrekt.
 */
export function useLockScrollWhenFits(deps: unknown[] = []) {
  useEffect(() => {
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;

    const measure = () => {
      const fits = html.scrollHeight <= window.innerHeight + 1;
      html.style.overflow = fits ? "hidden" : prevHtml;
      document.body.style.overflow = fits ? "hidden" : prevBody;
    };

    measure();
    // Efter paint + en kort stund: fånga sen layout-settling (typsnitt, reflow).
    const raf = requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 150);
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
    // deps styr omätning vid dataändring; measure/prev* är stabila per körning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
