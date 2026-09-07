"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

/** Bottenflikarnas klarering (h-16 i BottomTabs) — plus safe-area i CSS nedan. */
const TAB_BAR_PX = 64;
const MIN_PX = 240;
/**
 * iOS animerar tangentbordet in på ~0,25 s med en egen kurva. `keyboardWillShow`
 * fyrar FÖRE animationen och bär slutlig höjd, så en lika lång övergång på
 * kolumnens höjd gör att skrivfältet följer med tangentbordet upp i stället för
 * att hoppa dit på en bildruta. Android saknar motsvarande kurva — samma tid ser
 * ändå mjuk ut där.
 */
const KEYBOARD_EASE = "cubic-bezier(0.17, 0.59, 0.4, 1)";
const KEYBOARD_MS = 250;

/**
 * Samtalets skal: en kolumn med EXAKT den höjd som finns kvar under skalets
 * chrome, så att meddelandelistan scrollar internt och skrivfältet alltid står
 * längst ner — ovanför bottenflikarna, och ovanför tangentbordet när det är uppe.
 *
 * Höjden MÄTS (elementets topp i dokumentet) i stället för att räknas ur
 * headerns/paddingens rem-tal: ui-shell.md listar redan tre poster som måste dras
 * av och glöms EN scrollar sidan. Mätningen kan inte glömma en.
 *
 * Tangentbord uppe: flikraden är antingen dold (webben, BottomTabs gömmer sig
 * själv) eller täckt (native, `Keyboard resize: none`) → dess klarering dras
 * inte av då, annars står skrivfältet 64 px ovanför tangentbordet.
 *
 * `-mb-6` tar bort app-skalets `py-6`-botten så kolumnen når ända ner.
 */
export function ConversationScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const kb = useKeyboardHeight(true);
  const [px, setPx] = useState<number | null>(null);
  const [withTabs, setWithTabs] = useState(true);
  // Första mätningen sätter höjden från "ingen höjd" — den får INTE animeras
  // (kolumnen hade vikt ihop sig synligt vid inträdet). Övergången slås på
  // efteråt, och bara när användaren inte bett om mindre rörelse.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const tabs = !desktop && kb === 0;
      setWithTabs(tabs);
      setPx(Math.max(MIN_PX, window.innerHeight - top - kb - (tabs ? TAB_BAR_PX : 0)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [kb]);

  useEffect(() => {
    if (px == null || animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, [px, animate]);

  return (
    <div
      ref={ref}
      className="-mb-6 flex min-w-0 flex-col overflow-x-hidden"
      style={{
        height:
          px == null
            ? undefined
            : withTabs
              ? `calc(${px}px - env(safe-area-inset-bottom))`
              : `${px}px`,
        // Före mätningen: något rimligt så första bilden inte är en tom remsa.
        minHeight: px == null ? "60dvh" : undefined,
        transition: animate ? `height ${KEYBOARD_MS}ms ${KEYBOARD_EASE}` : undefined,
      }}
    >
      {children}
    </div>
  );
}
