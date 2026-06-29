"use client";

import { useRef } from "react";
import { useToast } from "@/components/ui/toast";

const HOLD_MS = 450;

// Kopierar via clipboard-API, faller tillbaka på execCommand. MÅSTE anropas i en
// användargest (pointerup) — annars ger WKWebView NotAllowedError. Textarean är
// markeringsbar trots global user-select:none (input/textarea är återställda).
function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => legacyCopy(text)
    );
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
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
    void copyText(text).then((ok) =>
      toast(
        ok
          ? { title: "Namnet kopierat", variant: "success" }
          : { title: "Kunde inte kopiera", variant: "error" }
      )
    );
  }

  return (
    <h1
      className={className}
      onPointerDown={() => {
        downAt.current = Date.now();
      }}
      onPointerUp={onUp}
      onPointerLeave={() => {
        downAt.current = null;
      }}
      onPointerCancel={() => {
        downAt.current = null;
      }}
    >
      {text}
    </h1>
  );
}
