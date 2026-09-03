"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
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

  // Tangentbordshöjd → kapa overlayn ovanför tangentbordet så panelen aldrig hamnar
  // bakom det. Mätningen (Capacitor-bryggan i appen, visualViewport på webben)
  // delas med arket och chatten — se hooks/use-keyboard-height.ts.
  const kbHeight = useKeyboardHeight(open);

  // Fokuserat fält (t.ex. Sälj-modalens beskrivning) scrollas in i vy när
  // tangentbordet öppnas — annars döljs det bakom tangentbordet. När fältet lämnas
  // och tangentbordet stängs växer den synliga ytan tillbaka → allt syns igen.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.("input, textarea, select")) return;
      // Vänta ut tangentbordets animation (visualViewport krymper) före scroll.
      window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    };
    panel.addEventListener("focusin", onFocusIn);
    return () => panel.removeEventListener("focusin", onFocusIn);
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
      // Overlayn spänner top:0 → bottom:kbHeight = ytan OVANFÖR tangentbordet.
      // Tangentbord uppe (kbHeight>0): BOTTEN-ställd med fast gap (pb-8) så ALLA
      // modaler lyfts lika högt ovanför tangentbordet, och max-h-full kapar panelen
      // till den ytan → höga modaler (Sälj) scrollar internt istället för att gömmas
      // bakom tangentbordet. Inget tangentbord: centrerad i hela skärmen.
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex justify-center overflow-y-auto px-4",
        kbHeight > 0 ? "items-end pb-8 pt-4" : "items-center py-4"
      )}
      style={{ bottom: kbHeight }}
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
