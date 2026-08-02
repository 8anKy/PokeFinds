"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseKronorToOre } from "@/lib/purchase-price";

export interface QuickAddDraft {
  quantity: number;
  /** Öre, heltal. Utelämnas helt när fältet lämnats blankt (≠ 0 kr). */
  purchasePrice?: number;
}

interface CollectionQuickAddPopoverProps {
  /** "+"-knappen popovern ankras mot. */
  anchor: HTMLElement | null;
  onClose: () => void;
  onConfirm: (draft: QuickAddDraft) => void;
}

/** API:t (`/api/collection`) tar quantity 1..10000 — samma tak här, annars 400. */
const MAX_QTY = 10000;
const PANEL_MIN_W = 236;
/** Luft mellan knapp och panel, och mellan panel och skärmkant. */
const GAP = 8;
const MARGIN = 10;

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Stepper-popovern bakom långtrycket på "+": antal + valfritt inköpspris.
 *
 * PORTAL, inte ett barn till kortet: ProductCard har `overflow-hidden` (bilden
 * rundas mot kanten), så en absolut positionerad panel inuti kortet hade kapats
 * vid kortkanten. Portalen läggs på <body> och positioneras `fixed` mot knappens
 * getBoundingClientRect() — samma resonemang som skannerns beskärning: MÄT
 * elementet, hårdkoda aldrig kortets mått.
 */
export function CollectionQuickAddPopover({
  anchor,
  onClose,
  onConfirm,
}: CollectionQuickAddPopoverProps) {
  const t = useTranslations("Product");
  const panelRef = useRef<HTMLDivElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [showError, setShowError] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // onClose är en inline-arrow hos anroparen (ny identitet varje render). Läs den
  // via ref så effekterna nedan inte startas om vid varje tangenttryck — samma
  // fälla som Modal dokumenterar (fokus stals → tangentbordet stängdes).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const parsed = parseKronorToOre(priceText);
  const priceInvalid = parsed.kind === "invalid";

  const reposition = useCallback(() => {
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;

    // visualViewport = den yta som FAKTISKT syns (tangentbordet krymper den på
    // webb/PWA). `fixed` och getBoundingClientRect() räknas båda i layout-
    // viewportens koordinater, och vv.offsetTop/Left är den visuella ytans
    // förskjutning i just det systemet → klampa mot [offset, offset + size].
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const vTop = vv?.offsetTop ?? 0;
    const vLeft = vv?.offsetLeft ?? 0;
    const vW = vv?.width ?? window.innerWidth;
    const vH = vv?.height ?? window.innerHeight;

    // Föredra OVANFÖR knappen: "+" sitter i kortets nederkant och tangentbordet
    // kommer underifrån — under knappen hade panelen hamnat bakom det.
    let top = r.top - GAP - ph;
    if (top < vTop + MARGIN) {
      const below = r.bottom + GAP;
      top =
        below + ph <= vTop + vH - MARGIN
          ? below
          : Math.max(vTop + MARGIN, vTop + vH - MARGIN - ph);
    }
    // Högerkantsjusterad mot knappen (den sitter i kortets högerkant).
    const left = Math.min(
      Math.max(r.right - pw, vLeft + MARGIN),
      vLeft + vW - MARGIN - pw
    );
    setPos({ top, left });
  }, [anchor]);

  // Mät i layouteffekten (före paint) så panelen aldrig blinkar förbi i 0,0.
  // Felraden ändrar panelens HÖJD, och när panelen står ovanför knappen räknas
  // toppen ur höjden → utan omräkning hade felmeddelandet lagt sig över knappen.
  useLayoutEffect(() => {
    reposition();
  }, [reposition, showError, priceInvalid]);

  // Kortet kan scrolla under en öppen popover (eller tangentbordet flytta den
  // synliga ytan) — följ ankaret i stället för att stänga, annars stängs panelen
  // av webbläsarens egen scroll-till-fokuserat-fält när prisfältet får fokus.
  useEffect(() => {
    let frame = 0;
    const onViewportChange = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };
    // capture: scrollen sker i en inre container på vissa vyer, inte på window.
    window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    window.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onViewportChange, { capture: true });
      window.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [reposition]);

  // Stäng vid tryck utanför. `pointerdown` (inte `mousedown`) täcker både touch
  // och mus i ETT event. Popovern öppnas mitt i en pågående pekarsekvens, så
  // den sekvensens egen pointerdown har redan passerat → ingen självstängning.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchor]);

  // Escape + enkel fokusfälla. Fokus läggs på PANELEN, inte på prisfältet: att
  // öppna tangentbordet direkt på mobil hade dolt halva panelen, och antalet är
  // det man oftast vill ändra.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
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

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Tillbaka till "+"-knappen så tangentbordsnavigeringen inte tappar platsen.
      previouslyFocused?.focus?.();
    };
  }, []);

  function step(delta: number) {
    setQuantity((q) => Math.min(MAX_QTY, Math.max(1, q + delta)));
  }

  function confirm() {
    if (parsed.kind === "invalid") {
      setShowError(true);
      return;
    }
    onConfirm({
      // Fältet får stå tomt (0) MEDAN man skriver — men API:t tar 1..10000, så
      // klampa här också och inte bara på blur (Enter hinner före blur).
      quantity: Math.min(MAX_QTY, Math.max(1, quantity)),
      // Blankt fält → fältet utelämnas HELT. 0 vore "köpt gratis", inte "vet inte".
      ...(parsed.kind === "ok" ? { purchasePrice: parsed.ore } : {}),
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("quickAddTitle")}
      tabIndex={-1}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth: PANEL_MIN_W,
        // Osynlig tills den är mätt — utan detta blinkar panelen förbi i 0,0.
        visibility: pos ? "visible" : "hidden",
      }}
      // Klick i panelen får aldrig nå kortets "stretched link" eller kortets egna
      // hanterare. Portalen ligger på <body>, men React låter events bubbla i
      // KOMPONENTTRÄDET — alltså tillbaka in i kortet.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      // max-w = viewport minus vår marginal på båda sidor: en smal telefon får
      // aldrig en panel som klampningen inte kan få in på skärmen.
      className="fixed z-50 max-w-[calc(100vw-20px)] animate-scale-in rounded-xl border border-surface-border bg-surface-overlay p-3 shadow-card outline-none"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {t("quickAddTitle")}
      </p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink-muted">{t("quantity")}</span>
        <div className="flex items-center gap-1.5">
          <StepButton
            label={t("decreaseQuantity")}
            disabled={quantity <= 1}
            onClick={() => step(-1)}
          >
            −
          </StepButton>
          <input
            type="text"
            inputMode="numeric"
            aria-label={t("quantity")}
            value={quantity === 0 ? "" : quantity}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              // Tomt fält tillåts under skrivandet; normaliseras på blur.
              setQuantity(digits ? Math.min(MAX_QTY, Number(digits)) : 0);
            }}
            onBlur={() => setQuantity((q) => (q >= 1 ? q : 1))}
            className="h-9 w-14 rounded-lg border border-surface-border bg-surface px-1 text-center text-sm font-semibold tabular-nums text-ink outline-none transition-colors focus:border-holo-cyan focus:ring-2 focus:ring-holo-cyan/30"
          />
          <StepButton
            label={t("increaseQuantity")}
            disabled={quantity >= MAX_QTY}
            onClick={() => step(1)}
          >
            +
          </StepButton>
        </div>
      </div>

      <label className="mt-3 block text-sm text-ink-muted" htmlFor="quick-add-price">
        {t("purchasePriceOptional")}
      </label>
      <div className="relative mt-1">
        <Input
          id="quick-add-price"
          type="text"
          // Svenska tangentbord ger komma; "decimal" visar det, "numeric" gör det inte.
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={t("purchasePricePlaceholder")}
          value={priceText}
          aria-invalid={showError && priceInvalid}
          aria-describedby={showError && priceInvalid ? "quick-add-price-error" : undefined}
          onChange={(e) => {
            setPriceText(e.target.value);
            setShowError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
          className={cn("h-9 bg-surface pr-9 text-sm", priceInvalid && showError && "border-fall")}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-faint"
        >
          kr
        </span>
      </div>
      {showError && priceInvalid && (
        <p id="quick-add-price-error" role="alert" className="mt-1 text-xs text-fall">
          {t("purchasePriceInvalid")}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("quickAddCancel")}
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={confirm}>
          {t("quickAddConfirm")}
        </Button>
      </div>
    </div>,
    document.body
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-surface-border bg-surface text-base leading-none text-holo-cyan transition-colors hover:bg-surface-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan disabled:opacity-40"
    >
      {children}
    </button>
  );
}
