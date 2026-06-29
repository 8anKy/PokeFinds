"use client";

import { useRef } from "react";
import { useToast } from "@/components/ui/toast";

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

  function onUp() {
    const start = downAt.current;
    downAt.current = null;
    if (start == null || Date.now() - start < HOLD_MS) return;
    const ok = copyText(text);
    toast(
      ok
        ? { title: "Namnet kopierat", variant: "success" }
        : { title: "Kunde inte kopiera", variant: "error" }
    );
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
      }}
      onPointerUp={onUp}
      onPointerCancel={() => {
        downAt.current = null;
      }}
    >
      {text}
    </h1>
  );
}
