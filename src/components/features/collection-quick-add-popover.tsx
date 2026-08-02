"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { parseKronorToOre } from "@/lib/purchase-price";

export interface QuickAddDraft {
  quantity: number;
  /** Öre, heltal. Utelämnas helt när fältet lämnats blankt (≠ 0 kr). */
  purchasePrice?: number;
}

interface CollectionQuickAddSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (draft: QuickAddDraft) => void;
}

/** API:t (`/api/collection`) tar quantity 1..10000 — samma tak här, annars 400. */
const MAX_QTY = 10000;

/**
 * Snabbtillägget bakom långtrycket på "+": antal + valfritt inköpspris.
 *
 * BOTTENARK, inte en popover vid knappen (ägarbeslut 2026-08-02). Den ska kännas
 * som katalogens filter-/sorteringsark — glider upp underifrån, tar hela bredden,
 * bekräftas med en knapp i foten. Skalet är delat (`ui/bottom-sheet.tsx`), så
 * tangentbordslyftet med sin Capacitor-fälla finns i ETT exemplar.
 *
 * Vad formbytet gjorde ÖVERFLÖDIGT — och det var hela vinsten: ankarmätning mot
 * knappens getBoundingClientRect(), portal förbi kortets `overflow-hidden`,
 * flip över/under, klampning mot visualViewport, omräkning när felraden ändrar
 * höjden, följ-ankaret-vid-scroll och en egen fokusfälla. Ett ark är fäst vid
 * skärmen, inte vid ett kort, så ingen av de frågorna finns längre.
 */
export function CollectionQuickAddPopover({
  open,
  onClose,
  onConfirm,
}: CollectionQuickAddSheetProps) {
  const t = useTranslations("Product");
  const [quantity, setQuantity] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [showError, setShowError] = useState(false);

  const parsed = parseKronorToOre(priceText);
  const priceInvalid = parsed.kind === "invalid";

  const step = (delta: number) =>
    setQuantity((q) => Math.min(MAX_QTY, Math.max(1, (q || 1) + delta)));

  function confirm() {
    if (priceInvalid) {
      setShowError(true);
      return;
    }
    onConfirm({
      quantity: Math.min(MAX_QTY, Math.max(1, quantity || 1)),
      // Blankt fält utelämnas HELT. `0` betyder "köpt gratis" och är ett
      // påstående; blankt betyder "vet inte" — de får inte slås ihop, för
      // portföljens vinstberäkning utesluter poster utan inköpspris med flit.
      ...(parsed.kind === "ok" ? { purchasePrice: parsed.ore } : {}),
    });
  }

  return (
    <BottomSheet
      open={open}
      title={t("quickAddTitle")}
      onClose={onClose}
      closeLabel={t("quickAddCancel")}
      footer={<BottomSheetCta onClick={confirm}>{t("quickAddConfirm")}</BottomSheetCta>}
    >
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-sm text-ink">{t("quantity")}</span>
        <div className="flex items-center gap-2">
          <StepButton label={t("decreaseQuantity")} disabled={quantity <= 1} onClick={() => step(-1)}>
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
            className="h-11 w-16 rounded-lg border border-surface-border bg-surface px-1 text-center text-base font-semibold tabular-nums text-ink outline-none transition-colors focus:border-holo-cyan focus:ring-2 focus:ring-holo-cyan/30"
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

      <label className="mt-4 block text-sm text-ink" htmlFor="quick-add-price">
        {t("purchasePriceOptional")}
      </label>
      <div className="relative mt-1.5">
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
          className={cn("h-11 bg-surface pr-10", priceInvalid && showError && "border-fall")}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-faint"
        >
          kr
        </span>
      </div>
      {showError && priceInvalid && (
        <p id="quick-add-price-error" role="alert" className="mt-1.5 text-xs text-fall">
          {t("purchasePriceInvalid")}
        </p>
      )}
    </BottomSheet>
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
      // 44px: arket är en tumyta, inte en pekaryta — samma mått som appens
      // övriga primära träffytor.
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-surface-border bg-surface text-lg leading-none text-holo-cyan transition-colors hover:bg-surface-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan disabled:opacity-40"
    >
      {children}
    </button>
  );
}
