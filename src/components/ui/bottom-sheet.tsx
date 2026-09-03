"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

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

  // Tangentbordshöjd → arket lyfts ovanför tangentbordet i stället för att hamna
  // bakom det (prisfältets sifferknappsats täckte hela panelen). Mätningen delas
  // med modalen och chatten — se hooks/use-keyboard-height.ts.
  const kbHeight = useKeyboardHeight(open);

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


  if (!open || typeof document === "undefined") return null;

  /**
   * ⛔ PORTAL TILL <body> — ARKET FÅR INTE RENDERAS DÄR DET ÅBEROPAS.
   *
   * `position: fixed` räknas mot närmaste förfader med `transform`, `filter`,
   * `perspective`, `contain` eller `will-change` — en sådan förfader blir
   * containing block även för fixed. Produktkortet har `hover:-translate-y-0.5
   * active:scale-[0.98]` OCH `overflow-hidden`, så snabbtilläggets ark ritades
   * INUTI kortet och klipptes mot dess kant i stället för att täcka skärmen
   * (rapporterat 2026-08-02, syntes som ett ark inklämt i ett kort i rutnätet).
   *
   * Portalen tar arket ur komponentträdets DOM-position men BEHÅLLER det i
   * React-trädet — context och event-bubbling fungerar som vanligt, vilket är
   * skälet att anropare inte behöver ändras.
   */
  return createPortal(
    <div
      // Överlagringen slutar där tangentbordet börjar → panelen (justify-end)
      // landar ovanpå det, och max-h räknas mot den mindre ytan så innehållet
      // scrollar i stället för att tryckas utanför skärmen.
      className="fixed inset-x-0 top-0 z-50 flex flex-col justify-end bg-black/55 backdrop-blur-[3px]"
      style={{ bottom: kbHeight }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Klick i arket får aldrig nå kortets "stretched link". Portalen ligger på
      // <body>, men React låter events bubbla i KOMPONENTTRÄDET — alltså
      // tillbaka in i kortet som öppnade arket.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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
    </div>,
    document.body
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
