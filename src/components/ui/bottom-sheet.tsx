"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bottenark — appens ENDA glid-upp-panel.
 *
 * Formen kommer från katalogens filter-/sorteringsark: mörk överlagring, rundad
 * panel som glider upp underifrån, draghandtag, rubrikrad med valfri åtgärd till
 * höger, scrollande kropp och en fast fot med huvudknappen. Den formen är nu
 * appens standard för "välj något och bekräfta" på mobil (ägarbeslut 2026-08-02:
 * snabbtillägget skulle kännas som filtren, inte som en popover vid knappen).
 *
 * ⛔ EN implementation, inte två. Tangentbordsmätningen nedan är den kluriga
 * delen och den har en dokumenterad Capacitor-fälla — den får inte kopieras runt
 * i appen. Anropare skickar in innehåll och fot, inget mer.
 */
export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Skärmläsaretikett för den osynliga stäng-ytan bakom panelen. */
  closeLabel: string;
  /** Valfri textknapp längst till höger i rubrikraden ("Rensa"). */
  headerAction?: { label: string; onClick: () => void };
  children: ReactNode;
  /** Fast fot. Utelämnas den får arket ingen fot alls. */
  footer?: ReactNode;
}

export function BottomSheet({
  open,
  title,
  onClose,
  closeLabel,
  headerAction,
  children,
  footer,
}: BottomSheetProps) {
  // onClose är typiskt en inline-arrow hos anroparen (ny identitet varje
  // rendering). Läs den via ref så effekterna nedan inte startas om vid varje
  // tangenttryck — annars stjäls fokus och tangentbordet stängs.
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tangentbordshöjd → arket lyfts ovanför tangentbordet i stället för att hamna
  // bakom det (prisfältets sifferknappsats täckte hela panelen). Samma mätning
  // som ui/modal.tsx: native-appen kör Keyboard resize:none, så varken
  // WKWebView:en eller visualViewport krymper där — Capacitor-bryggan är enda
  // pålitliga signalen. På webb/PWA finns ingen brygga → visualViewport.
  useEffect(() => {
    if (!open) return;
    const cleanups: (() => void)[] = [];
    const kb = (globalThis as { Capacitor?: { Plugins?: { Keyboard?: any } } }).Capacitor
      ?.Plugins?.Keyboard;
    if (kb?.addListener) {
      const add = (ev: string, fn: (i: any) => void) => {
        const p = kb.addListener(ev, fn);
        Promise.resolve(p)
          .then((h: any) => cleanups.push(() => h?.remove?.()))
          .catch(() => {});
      };
      add("keyboardWillShow", (i: { keyboardHeight?: number }) =>
        setKbHeight(i?.keyboardHeight ?? 0)
      );
      add("keyboardWillHide", () => setKbHeight(0));
    } else if (typeof window !== "undefined" && window.visualViewport) {
      const vp = window.visualViewport;
      const update = () => setKbHeight(Math.max(0, window.innerHeight - vp.height - vp.offsetTop));
      vp.addEventListener("resize", update);
      vp.addEventListener("scroll", update);
      update();
      cleanups.push(() => {
        vp.removeEventListener("resize", update);
        vp.removeEventListener("scroll", update);
      });
    }
    return () => {
      cleanups.forEach((c) => c());
      setKbHeight(0);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // Överlagringen slutar där tangentbordet börjar → panelen (justify-end)
      // landar ovanpå det, och max-h räknas mot den mindre ytan så innehållet
      // scrollar i stället för att tryckas utanför skärmen.
      className="fixed inset-x-0 top-0 z-50 flex flex-col justify-end bg-black/55 backdrop-blur-[3px]"
      style={{ bottom: kbHeight }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative flex max-h-[84%] flex-col rounded-t-[20px] bg-surface pt-2 shadow-[0_-1px_0_0_rgba(255,255,255,0.06)] animate-slide-up">
        <span
          aria-hidden="true"
          className="mx-auto mb-3 mt-1.5 h-1 w-9 rounded-full bg-surface-border"
        />
        <div className="flex items-center justify-between px-[18px] pb-3">
          <p className="text-base font-bold tracking-[-0.01em] text-ink">{title}</p>
          {headerAction && (
            <button
              type="button"
              onClick={headerAction.onClick}
              className="text-xs font-medium text-ink-faint transition-colors hover:text-ink"
            >
              {headerAction.label}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[18px]">{children}</div>
        {footer && (
          <div
            className={cn(
              "px-[18px] pt-3.5",
              // Tangentbord uppe: överlagringen slutar redan ovanför det → ingen
              // extra säkerhetsmarginal (den hade lyft knappen 30px för högt).
              kbHeight > 0 ? "pb-3.5" : "pb-[max(1.875rem,env(safe-area-inset-bottom))]"
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Huvudknappen i ett bottenarks fot — samma vikt/form som filtrens "Visa N". */
export function BottomSheetCta({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-[10px] bg-holo-cyan px-4 py-3.5 text-sm font-bold tabular-nums text-surface transition-opacity active:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
