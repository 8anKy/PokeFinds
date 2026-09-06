"use client";

import { useEffect, useRef } from "react";
import { useKeyboardHeight } from "./use-keyboard-height";

/** Luft mellan fältets underkant och tangentbordets överkant. */
const GAP = 24;

function isField(node: EventTarget | null): node is HTMLElement {
  if (!node || !(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

/**
 * Rullar `el` så att den — plus ev. `data-kb-reserve` px under den (en
 * öppen förslagslista) — ryms ovanför tangentbordet.
 */
function ensureVisible(el: HTMLElement, kb: number) {
  if (kb <= 0) return;
  const reserve = Number.parseInt(el.dataset.kbReserve ?? "", 10);
  const rect = el.getBoundingClientRect();
  const needBottom = rect.bottom + (Number.isFinite(reserve) ? reserve : 0) + GAP;
  const overflow = needBottom - (window.innerHeight - kb);
  if (overflow > 0) window.scrollBy({ top: overflow, behavior: "smooth" });
}

/**
 * HELSIDESFORMULÄR I APPEN: tangentbordet läggs OVANPÅ webbvyn
 * (`Keyboard: { resize: "none" }` i capacitor.config.ts — annars hoppar
 * position:fixed-flikraden), så varken WKWebView:en eller visualViewport
 * krymper. Följden är att sidans nedersta fält hamnar under tangentbordet OCH
 * att det inte finns någon rullmån kvar att lyfta upp dem med — webbläsarens
 * egen "scroll focused field into view" har inget att rulla till.
 *
 * Hooken returnerar höjden att lägga som `padding-bottom` på formuläret (=
 * rullmånen) och rullar det fokuserade fältet ovanför tangentbordet, både när
 * det öppnas och när fokus flyttas mellan fält medan det står uppe. Fält som
 * öppnar en lista under sig märks med `data-kb-reserve="<px>"`.
 *
 * ⛔ Modaler/bottenark ska INTE använda den här — de kapar sin egen höjd i
 * ui/modal.tsx resp. ui/bottom-sheet.tsx ur samma mätning.
 */
export function useKeyboardInset(): number {
  const kb = useKeyboardHeight(true);
  const kbRef = useRef(kb);
  kbRef.current = kb;

  // Höjden kommer via keyboardWillShow EFTER fokus — rulla när den är känd.
  useEffect(() => {
    if (kb <= 0) return;
    const el = document.activeElement;
    if (!isField(el)) return;
    const id = window.setTimeout(() => ensureVisible(el, kb), 60);
    return () => window.clearTimeout(id);
  }, [kb]);

  // Fokusbyte medan tangentbordet redan står uppe ger ingen ny höjd.
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const el = e.target;
      if (!isField(el)) return;
      window.requestAnimationFrame(() => ensureVisible(el, kbRef.current));
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return kb;
}
