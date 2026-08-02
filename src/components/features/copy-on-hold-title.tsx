"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { hapticTick } from "@/lib/haptics";

const HOLD_MS = 450;

// Synkron kopiering via execCommand i själva gesten. Den async clipboard-API:n
// avvisas av WKWebView när gesten rörde sig (tolkas som drag, inte tap) — därför
// undviker vi den här och gör en markering + copy direkt. iOS kräver Range +
// setSelectionRange (inte bara .select()). Textarean är markeringsbar trots global
// user-select:none (input/textarea är återställda).
function copyText(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.readOnly = true; // hindrar tangentbordet från att poppa upp
    ta.contentEditable = "true";
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);

    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Långtryck (~450 ms) på produktnamnet kopierar det — ersätter den avstängda
// markera-och-kopiera-gesten. Kopian sker på pointerup så gesten bevaras.
export function CopyOnHoldTitle({ text, className }: { text: string; className?: string }) {
  const { toast } = useToast();
  const downAt = useRef<number | null>(null);
  /** Timern som "beväpnar" gesten — se kommentaren vid onPointerDown. */
  const armTimer = useRef<number | null>(null);

  function disarm() {
    if (armTimer.current != null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    downAt.current = null;
  }

  // Städa om komponenten lämnas mitt i ett tryck (produktsidan kan stängas med
  // svep) — annars vibrerar en avmonterad komponent 450 ms senare.
  useEffect(() => disarm, []);

  function onUp() {
    const start = downAt.current;
    disarm();
    if (start == null || Date.now() - start < HOLD_MS) return;
    // Tyst vid miss (t.ex. liten svep → iOS nekar in-page-kopian) — bara kvitto
    // när det faktiskt lyckas, ingen störande "Kunde inte kopiera".
    if (copyText(text)) {
      toast({ title: "Namnet kopierat", variant: "success" });
    }
  }

  return (
    <h1
      className={className}
      // touch-action: none → en liten svep medan man håller tolkas inte som scroll
      // (annars pointercancel → kopian avbryts). Bara hålltiden räknas, inte rörelsen.
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        downAt.current = Date.now();
        e.currentTarget.setPointerCapture(e.pointerId);
        // Kvittensen kommer NÄR gesten löser ut, inte när fingret släpps.
        // Kopian sker fortfarande på pointerup (den gesten är oförändrad), men
        // utan det här ticket får man ingen aning om att man hållit länge nog
        // förrän man lyfter — och lyfter man för tidigt händer bara ingenting.
        armTimer.current = window.setTimeout(() => {
          armTimer.current = null;
          hapticTick();
        }, HOLD_MS);
      }}
      onPointerUp={onUp}
      onPointerCancel={disarm}
    >
      {text}
    </h1>
  );
}
