"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconX } from "@/components/ui/icons";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose är ofta en inline-arrow (ny identitet varje render). Läs den via ref så
  // effekten nedan BARA beror på `open` — annars körs den om vid varje tangenttryck
  // och stjäl fokus från inputen (→ tangentbordet stängs efter en siffra).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Krymp overlayn till den SYNLIGA ytan (visualViewport) när tangentbordet öppnas.
  // En `fixed inset-0`-overlay mäts annars mot layout-viewporten, som inte krymper
  // i WKWebView → panelens innehåll hamnar bakom tangentbordet. Med rätt höjd kan
  // panelens egen overflow-scroll visa fältet man skriver i.
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => setViewport({ top: vp.offsetTop, height: vp.height });
    update();
    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
      setViewport(null);
    };
  }, [open]);

  // ESC för att stänga + enkel fokusfälla
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // Centrerad i den SYNLIGA ytan: höjden begränsas till visualViewport när
      // tangentbordet är uppe, så centrering lägger panelen i gapet mellan
      // statusraden och tangentbordet (i st.f. att slå i toppen av telefonen).
      className="fixed inset-x-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={viewport ? { top: viewport.top, height: viewport.height } : { top: 0, bottom: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Bakgrund */}
      <div
        className="absolute inset-0 animate-fade-in bg-surface/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          // flex-col + max-h-full: panelen kapas till den synliga ytan (containerns
          // höjd = visualViewport när tangentbordet är uppe) så header + footer alltid
          // syns och BARA innehållet scrollar — footern hamnar aldrig bakom tangentbordet.
          "card-surface relative z-10 flex max-h-full w-full max-w-lg flex-col overflow-hidden animate-scale-in shadow-card outline-none",
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-overlay hover:text-ink"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-surface-border px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
