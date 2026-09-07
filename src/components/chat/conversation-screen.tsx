"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

/** Bottenflikarnas klarering (h-16 i BottomTabs) — plus safe-area i CSS nedan. */
const TAB_BAR_PX = 64;
const MIN_PX = 240;
/**
 * Tangentbordet glider upp på ~0,2–0,25 s. iOS `keyboardWillShow` fyrar FÖRE
 * animationen och bär slutlig höjd, så en lika lång övergång gör att skrivfältet
 * följer med upp i stället för att hoppa dit på en bildruta. Android fyrar först
 * när tangentbordet redan är uppe — kortare tid gör att vi hinner ifatt.
 */
const KEYBOARD_EASE = "cubic-bezier(0.17, 0.59, 0.4, 1)";
const KEYBOARD_MS = 200;

/**
 * Samtalets skal: en kolumn med EXAKT den höjd som finns kvar under skalets
 * chrome, så att meddelandelistan scrollar internt och skrivfältet alltid står
 * längst ner — ovanför bottenflikarna, och ovanför tangentbordet när det är uppe.
 *
 * Höjden MÄTS (elementets topp i dokumentet) i stället för att räknas ur
 * headerns/paddingens rem-tal: ui-shell.md listar redan tre poster som måste dras
 * av och glöms EN scrollar sidan. Mätningen kan inte glömma en.
 *
 * ⛔ **Det är HÖJDEN som ändras, aldrig en transform på innehållet.** Ett försök
 * (2026-09-07) att glida hela kolumnen uppåt med `translate3d` var mjukare men
 * FEL: allt i kolumnen följde med upp förbi klippkanten — först headern, sedan
 * de få bubblorna i ett kort samtal, som låg kvar i toppen och försvann ur bild
 * tills tangentbordet stängdes. Med höjden krymper bara den SYNLIGA ytan
 * nedifrån: innehåll som ligger i toppen står stilla (som det ska), och en lista
 * som står vid botten dras med av bottenpinningen i conversation-view.
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
  // (kolumnen vek ihop sig synligt vid inträdet). Övergången slås på efteråt,
  // och bara när användaren inte bett om mindre rörelse.
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
