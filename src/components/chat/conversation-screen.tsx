"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

/** Bottenflikarnas klarering (h-16 i BottomTabs) — plus safe-area i CSS nedan. */
const TAB_BAR_PX = 64;
const MIN_PX = 240;

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
      }}
    >
      {children}
    </div>
  );
}
