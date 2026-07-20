"use client";

import { useEffect, useRef } from "react";

/**
 * Sid-entré för template.tsx: kort opacity-fade vid varje navigering.
 *
 * VARFÖR KLASSEN MÅSTE TAS BORT EFTERÅT (bett oss TVÅ gånger 2026-07-20):
 * En CSS-animation på den här diven — som omsluter VARJE sida — håller en
 * STACKING CONTEXT så länge animationen är kopplad till elementet (Chrome
 * behåller den även efter avslut, oavsett fill-mode). Då fastnar sidans
 * fixed-dialoger (skannerns z-[60]) UNDER chrome-header/tabs (z-40, utanför
 * diven). Empiriskt verifierat med elementFromPoint-probe: klass på = header
 * vinner, klass av = dialogen vinner. Därför: animationend (+ timeout-reserv)
 * → ta bort klassen → ren div utan stacking context.
 *
 * Transform/filter är av samma skäl FÖRBJUDNA här (containing block-fällan).
 * Reduced motion: globals.css kortar animationen till 0.01ms → klassen ryker
 * direkt.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reserv om animationend aldrig fyras (t.ex. fliken i bakgrunden).
    const t = setTimeout(() => ref.current?.classList.remove("animate-page-in"), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      className="animate-page-in"
      onAnimationEnd={(e) => {
        // Barnens egna animationer (stagger-list m.fl.) bubblar hit — reagera
        // bara på divens egen.
        if (e.target === ref.current) ref.current?.classList.remove("animate-page-in");
      }}
    >
      {children}
    </div>
  );
}
