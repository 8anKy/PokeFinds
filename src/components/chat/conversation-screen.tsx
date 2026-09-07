"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

/** Bottenflikarnas klarering (h-16 i BottomTabs) — plus safe-area i CSS nedan. */
const TAB_BAR_PX = 64;
const MIN_PX = 240;
/**
 * iOS animerar tangentbordet in på ~0,25 s med en egen kurva; `keyboardWillShow`
 * fyrar FÖRE animationen och bär slutlig höjd, så en lika lång övergång gör att
 * skrivfältet följer med tangentbordet upp. Android saknar motsvarande kurva —
 * samma tid ser ändå mjuk ut där.
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
 * ⛔ **Tangentbordet flyttar kolumnen med TRANSFORM, aldrig med höjden.** Att
 * animera `height` (första försöket) lade en layout- OCH målningsrunda på hela
 * meddelandelistan i varje bildruta — i WebView:en syntes det som hackig, släpande
 * uppgång. Nu byter kolumnen layout EN gång (padding-top = förskjutningen, så
 * listan blir exakt den synliga ytan och hela historiken går att nå) och glider
 * sedan på kompositorn: `translate3d` rör varken layout eller målning.
 * Ytterhöljet klipper det som far upp förbi headern.
 *
 * ⛔ **Samtalets header ska ligga UTANFÖR skalet** (den renderas som syskon i
 * sidan). Allt som står här inne förskjuts — headern inuti gled upp ur bild när
 * tangentbordet öppnades och kom tillbaka först när det stängdes.
 *
 * Tangentbord uppe: flikraden är antingen dold (webben, BottomTabs gömmer sig
 * själv) eller täckt (native, `Keyboard resize: none`) → förskjutningen drar
 * därför av dess klarering, annars stannar skrivfältet 64 px ovanför tangentbordet.
 *
 * `-mb-6` tar bort app-skalets `py-6`-botten så kolumnen når ända ner.
 */
export function ConversationScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const kb = useKeyboardHeight(true);
  const [px, setPx] = useState<number | null>(null);
  const [desktop, setDesktop] = useState(false);
  // Första mätningen sätter höjden från "ingen höjd" — den får inte animeras.
  // Övergången slås på efteråt, och bara när användaren inte bett om mindre rörelse.
  const [animate, setAnimate] = useState(false);

  // ⛔ Mätningen beror INTE på tangentbordet: höljet behåller sin höjd hela tiden
  // och bara innehållet förskjuts. Annars vore vi tillbaka i en layout per bildruta.
  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
      setDesktop(isDesktop);
      setPx(Math.max(MIN_PX, window.innerHeight - top - (isDesktop ? 0 : TAB_BAR_PX)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Padding-top (som ger listan exakt den synliga ytan) läggs på FÖRST när
  // glidningen är klar: under den är listan full höjd och toppen klipps av höljet
  // — lägger man den direkt poppar en tom remsa upp under headern i bildruta ett.
  // Vid stängning tas den bort direkt (listan växer nedåt, bakom klippet).
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (kb <= 0) {
      setSettled(false);
      return;
    }
    if (!animate) {
      setSettled(true);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), KEYBOARD_MS + 40);
    return () => window.clearTimeout(id);
  }, [kb, animate]);

  useEffect(() => {
    if (px == null || animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, [px, animate]);

  const safeBottom = desktop ? "0px" : "env(safe-area-inset-bottom)";
  const tabs = desktop ? "0px" : `${TAB_BAR_PX}px`;
  // Flikraden och safe-arean ligger redan mellan kolumnens botten och skärmkanten
  // — bara resten av tangentbordet behöver lyftas.
  const shift = kb > 0 ? `max(0px, ${kb}px - ${tabs} - ${safeBottom})` : "0px";

  return (
    <div
      ref={ref}
      className="-mb-6 overflow-hidden"
      style={{
        height: px == null ? undefined : `calc(${px}px - ${safeBottom})`,
        // Före mätningen: något rimligt så första bilden inte är en tom remsa.
        minHeight: px == null ? "60dvh" : undefined,
      }}
    >
      <div
        className="flex h-full min-w-0 flex-col overflow-x-hidden"
        style={{
          paddingTop: settled ? shift : 0,
          transform: `translate3d(0, calc(-1 * ${shift}), 0)`,
          transition: animate ? `transform ${KEYBOARD_MS}ms ${KEYBOARD_EASE}` : undefined,
          willChange: animate ? "transform" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
