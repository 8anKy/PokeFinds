"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useEventCallback } from "@/hooks/use-event-callback";
import { classifyDrag, shouldCloseSheet } from "@/lib/sheet-drag";

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
 *
 * SVEP NEDÅT STÄNGER (2026-09-05, ägaren om paywall-arket: "jag kan inte svepa
 * ner det, jag måste trycka Inte nu"). Gesten är porterad rakt av från skannerns
 * ark, som betalade för läxorna — se kommentaren vid effekten och
 * `lib/sheet-drag.ts`, där själva domen bor och är testad.
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
  /**
   * Lyft arket över en helskärmsvärd (skannern är fixed z-[60] över hela appen).
   * Samma mekanism som produkt-overlayn — se registerFullscreenHost i
   * lib/product-overlay-open.ts. Default z-50: över sidans header, under skannern.
   */
  elevated?: boolean;
  /**
   * Extra klasser på själva panelen — t.ex. `sm:max-w-md sm:mx-auto` för ett ark som
   * inte ska spänna hela fönsterbredden på desktop. Mobilens form är alltid densamma.
   */
  panelClassName?: string;
}

export function BottomSheet({
  open,
  title,
  onClose: onCloseProp,
  closeLabel,
  headerAction,
  children,
  footer,
  elevated = false,
  panelClassName,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose är typiskt en inline-arrow hos anroparen (ny identitet varje
  // rendering). Stabil identitet här, annars rivs och sätts drag-lyssnarna om
  // vid varje rendering — mitt i ett svep har den nya uppsättningen aldrig sett
  // touchstart och arket fryser (skannerns bugg 2026-08-04). Samma skäl som att
  // Escape-effekten inte får starta om vid varje tangenttryck (fokus stjäls,
  // tangentbordet stängs).
  const onClose = useEventCallback(onCloseProp);

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
  }, [open, onClose]);

  /**
   * SVEP NEDÅT FÖR ATT STÄNGA — porterat från skannerns ark (skanna/page.tsx).
   *
   * ⛔ TOUCH-EVENTS, INTE POINTER-EVENTS. I WebKit avbryter ETT `preventDefault()`
   * på touchmove hela pointer-strömmen (`pointercancel`), och studsvakten i
   * `pwa-register.tsx` gör precis det på nedåtdrag när sidan står i topp. Touch-
   * events överlever; pointer gör det inte. Vakten opt-outar dessutom via
   * `data-drag-surface` på panelen.
   *
   * ⛔ RIKTNINGEN AVGÖRS UNDER WEBBLÄSARENS EGEN TRÖSKEL (3 px, `DIRECTION_PX`):
   * ett långsamt svep levererar 1–2 px per ruta, och passerar webbläsarens
   * ~5 px först tar DEN gesten och skickar touchcancel. Domen bor i
   * `lib/sheet-drag.ts` (testad) — ändra trösklarna där, aldrig här.
   *
   * TRE SAKER PÅ SAMMA YTA: vågrätt drag → någon annans (en chip-rad); drag uppåt
   * eller kroppen redan nedscrollad → vanlig scroll; drag nedåt i topp → vårt, och
   * arket följer fingret. Handtaget + rubrikraden (`data-sheet-handle`) startar
   * alltid ett drag; kroppen bara när den står i topp.
   *
   * STÄNGER PÅ STRÄCKA **ELLER** FART (`shouldCloseSheet`).
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let vy = 0;
    let dy = 0;
    let dragging = false;
    /** Gesten får bli vår (rätt startpunkt), men riktningen är ännu oläst. */
    let eligible = false;
    /** Riktningen är läst och den var nedåt — vi äger gesten. */
    let owning = false;
    let fromHandle = false;
    let fromRail = false;

    const begin = (x: number, y: number, t: number) => {
      startX = x;
      startY = y;
      lastY = y;
      lastT = t;
      dy = 0;
      vy = 0;
      eligible = true;
      owning = false;
      dragging = true;
    };

    const abort = () => {
      dragging = false;
      eligible = false;
      owning = false;
      panel.style.transition = "";
      panel.style.transform = "";
    };

    /** true = vi äger gesten och anroparen ska blockera native scroll. */
    const move = (x: number, y: number, t: number): boolean => {
      if (!dragging || !eligible) return false;
      const ddx = x - startX;
      const ddy = y - startY;
      if (!owning) {
        const decision = classifyDrag(ddx, ddy, fromHandle, fromRail);
        if (decision === "wait") return false;
        // En gest vi lämnat ifrån oss tas ALDRIG tillbaka mitt i.
        if (decision === "release") {
          abort();
          return false;
        }
        owning = true;
        // animate-slide-up (fill-mode both) pinnar transform och överröstar vår
        // inline-transform → måste rensas, annars syns ingen följning/glid.
        panel.style.animation = "none";
        panel.style.transition = "none";
      }
      dy = Math.max(0, ddy);
      if (t > lastT) {
        vy = (y - lastY) / (t - lastT);
        lastY = y;
        lastT = t;
      }
      panel.style.transform = `translateY(${dy}px)`;
      return true;
    };

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      eligible = false;
      // Riktningen hann aldrig läsas (en tapp) — inget att ångra, inget att stänga.
      if (!owning) return;
      owning = false;
      panel.style.transition = "transform 0.25s ease";
      if (shouldCloseSheet(dy, vy)) {
        panel.style.transform = "translateY(110%)";
        window.setTimeout(onClose, 230);
      } else {
        panel.style.transform = "";
      }
    };

    const isHandle = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.("[data-sheet-handle]");

    /** En nästlad lodrät lista som inte står i topp → upp/ned är dess egen scroll. */
    const startsInScrolledList = (target: EventTarget | null) => {
      let el = target as HTMLElement | null;
      while (el && el !== panel) {
        if (el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
        el = el.parentElement;
      }
      return false;
    };
    /** En sidledsscroller (chip-rad) — vår bara om draget är tydligt lodrätt. */
    const startsInHorizontalScroller = (target: EventTarget | null) => {
      let el = target as HTMLElement | null;
      while (el && el !== panel) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        abort();
        return;
      }
      fromHandle = isHandle(e.target);
      fromRail = !fromHandle && startsInHorizontalScroller(e.target);
      // Kroppen får bara starta ett drag när den redan står i topp — annars
      // vore varje scroll uppåt en stängning.
      if (!fromHandle && startsInScrolledList(e.target)) {
        dragging = false;
        eligible = false;
        return;
      }
      begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging || e.touches.length !== 1) return;
      const own = move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp);
      // Vi äger gesten: utan detta scrollar/studsar WebView:n samtidigt som
      // arket följer fingret — och värre, den TAR gesten och skickar touchcancel.
      // Sker bara efter riktningsbeslutet (3 px), så vågräta svep i en chip-rad
      // aldrig blockeras.
      if (own && e.cancelable) e.preventDefault();
    };

    // MUS: pointer-events duger på desktop (ingen touchmove-vakt, ingen WebView
    // som avbryter). Touch går uteslutande via touch-events ovan.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      fromHandle = isHandle(e.target);
      fromRail = false;
      if (!fromHandle && startsInScrolledList(e.target)) return;
      begin(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      move(e.clientX, e.clientY, e.timeStamp);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      finish();
    };

    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    panel.addEventListener("touchend", finish);
    // Ett avbrott (systemgest, inkommande samtal) döms som ett släpp och lämnar
    // ALDRIG gesten hängande.
    panel.addEventListener("touchcancel", finish);
    panel.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("touchend", finish);
      panel.removeEventListener("touchcancel", finish);
      panel.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [open, onClose]);

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
      className={cn(
        "fixed inset-x-0 top-0 flex flex-col justify-end bg-black/55 backdrop-blur-[3px]",
        elevated ? "z-[70]" : "z-50"
      )}
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
      <div
        ref={panelRef}
        // Studsvakten i pwa-register.tsx lämnar ytor med data-drag-surface ifred —
        // annars preventDefault:ar den vårt nedåtdrag och gesten dör mitt i.
        data-drag-surface=""
        className={cn(
          "relative flex max-h-[84%] flex-col rounded-t-[20px] bg-surface pt-2 shadow-[0_-1px_0_0_rgba(255,255,255,0.06)] animate-slide-up",
          panelClassName
        )}
      >
        {/* Handtag + rubrikrad = alltid en dragyta, oavsett hur kroppen står. */}
        <div data-sheet-handle="" className="cursor-grab touch-none select-none">
          <span
            aria-hidden="true"
            className="mx-auto mb-3 mt-1.5 block h-1 w-9 rounded-full bg-surface-border"
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
