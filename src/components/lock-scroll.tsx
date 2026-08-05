"use client";

import { useEffect } from "react";

/**
 * Låser body-scroll på sidor vars innehåll FÅR PLATS (Mer/Community/Bjud in), så
 * de inte går att studsa när det inte finns något under viken. Klipper bara den
 * tomma svansen.
 *
 * ⛔ "FÅR PLATS" ÄR EN MÄTNING, ALDRIG ETT ANTAGANDE. Låset var förut
 * ovillkorligt, och premissen "innehållet får plats" stod bara i en kommentar.
 * Den slutade gälla i samma sekund som något la till höjd: e-postbannern
 * (2026-08-05) sköt ner listan så att Adminpanel och Logga ut hamnade under
 * viken — och låset gjorde dem OMÖJLIGA att nå. Samma fälla väntar på längre
 * översättningar (engelska strängar är ofta längre), en lägre telefon, ett
 * kommande menyval eller ett framtida meddelande.
 *
 * Därför mäts det i stället, och mätningen görs OM när något ändrar höjden:
 * bannern dyker upp asynkront (den hämtar /api/users/me efter montering), så en
 * engångskoll vid montering hade missat exakt det fall som orsakade buggen.
 */
export function LockScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;

    // Nollställ FÖRE eventuellt lås — annars fryses sidan på föregående tabbens
    // scroll-position (overflow:hidden återställer inte scrollTop).
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });

    let locked: boolean | null = null;

    const apply = () => {
      // scrollHeight rapporterar innehållets fulla höjd även när overflow är
      // hidden, så mätningen är giltig i BÅDA lägena och kan inte låsa sig fast.
      // 1 px tolerans: delpixelhöjder ska inte få låset att flimra.
      const fits = html.scrollHeight <= window.innerHeight + 1;
      if (fits === locked) return;
      locked = fits;
      html.style.overflow = fits ? "hidden" : prevHtml;
      document.body.style.overflow = fits ? "hidden" : prevBody;
    };

    apply();

    // Innehåll som växer efter montering (bannern) OCH ytan som ändras
    // (rotation, tangentbord, adressfält som glider undan).
    const ro = new ResizeObserver(apply);
    ro.observe(document.body);
    window.addEventListener("resize", apply);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);
  return null;
}
