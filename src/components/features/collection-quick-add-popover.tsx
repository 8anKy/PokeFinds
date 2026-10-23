"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { parseKronorToOre } from "@/lib/purchase-price";
import {
  PRICED_CONDITIONS,
  priceForCondition,
  type ConditionPriceTable,
  type PricedCondition,
} from "@/lib/condition-prices";
import { PortfolioChips } from "@/components/features/portfolio-chips";
import { PortfolioCreateSheet } from "@/components/features/portfolio-sheets";
import { GradingPicker, gradingPayload, type GradingValue } from "@/components/features/grading-picker";
import {
  loadPortfolios,
  preferredPortfolioId,
  setLastPortfolioId,
  type PortfolioSummary,
} from "@/lib/portfolios-client";

export interface QuickAddDraft {
  quantity: number;
  /** Öre, heltal. Utelämnas helt när fältet lämnats blankt (≠ 0 kr). */
  purchasePrice?: number;
  /** Pärm att spara i. Utelämnad = standardpärmen. */
  portfolioId?: string;
  /** Gradering — bara när BÅDE bolag och betyg valts (2026-10-15). */
  gradingCompany?: string;
  grade?: string;
  /** Skick (2026-10-23, väljs redan vid tillägg). Bara för kort; utelämnat = NM (schemats default). */
  condition?: PricedCondition;
  /** Vald tryckning när den skiljer sig från produkten arket öppnades för. */
  productId?: string;
}

/** En tryckning arket kan spara som (produkten själv först). */
export interface QuickAddVariantOption {
  productId: string;
  /** `null` = vanlig version. */
  label: string | null;
  /** Rubrikpriset i öre — NM-raden. */
  headlinePrice: number | null;
  conditionPrices: ConditionPriceTable | null;
}

interface CollectionQuickAddSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (draft: QuickAddDraft) => void;
  /** Produktens namn under rubriken — produktsidan visar det (som Bevaka-arket), rutnätet inte. */
  productTitle?: string;
  /** Sparar just nu → knappen låses så ett dubbeltryck inte lägger till två gånger. */
  saving?: boolean;
  /** Skickas vidare till arket (t.ex. `sm:mx-auto sm:max-w-md` på produktsidan). */
  panelClassName?: string;
  /**
   * Kort (inte förseglat): visa graderingen — så att en slab kan läggas in direkt
   * i stället för att läggas till rå och graderas i efterhand (ägaren 2026-10-15).
   */
  gradeable?: boolean;
  /**
   * Tryckningar att välja mellan (produktsidan, 2026-10-23). Första posten = produkten
   * själv. Tom ⇒ inget tryckningsval och inga skickpriser (rutnätets "+").
   */
  variantOptions?: QuickAddVariantOption[];
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
  productTitle,
  saving = false,
  panelClassName,
  gradeable = false,
  variantOptions = [],
}: CollectionQuickAddSheetProps) {
  const t = useTranslations("Product");
  const tCond = useTranslations("Condition");
  const tDetail = useTranslations("Detail");
  // Skick + tryckning väljs FRÅN BÖRJAN (användarfeedback 2026-10-23) i stället för att
  // läggas in som NM och rättas i exemplararket efteråt.
  const [condition, setCondition] = useState<PricedCondition>("NEAR_MINT");
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [priceText, setPriceText] = useState("");
  const [showError, setShowError] = useState(false);
  // Pärmar (2026-09-21): raden visas bara när kontot har fler än en. Listan
  // delas med skannern (lib/portfolios-client), en hämtning per sidladdning.
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [grading, setGrading] = useState<GradingValue>({ gradingCompany: "", grade: "" });

  // Utgångsläget varje gång arket öppnas: 1 ex, inget pris. Ett tidigare tillägg
  // ska inte ligga kvar som förifyllt värde nästa gång. Pärmen däremot MINNS —
  // den som fyller "Byteshögen" vill inte välja om per kort.
  useEffect(() => {
    if (!open) return;
    setQuantity(1);
    setPriceText("");
    setShowError(false);
    setGrading({ gradingCompany: "", grade: "" });
    setCondition("NEAR_MINT");
    setVariantId(null);
    let active = true;
    loadPortfolios()
      .then((p) => {
        if (!active) return;
        setPortfolios(p.portfolios);
        setPortfolioId(preferredPortfolioId(p.portfolios));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  const parsed = parseKronorToOre(priceText);
  const priceInvalid = parsed.kind === "invalid";

  const selectedOption = variantOptions.find((o) => o.productId === variantId) ?? variantOptions[0] ?? null;
  const conditionPrice = selectedOption
    ? priceForCondition(selectedOption.conditionPrices, condition, selectedOption.headlinePrice)
    : null;
  const showConditionPrices = !!selectedOption && (selectedOption.conditionPrices != null || selectedOption.headlinePrice != null);

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
      // Skickas bara när det finns något att välja mellan — annars standardpärmen.
      ...(portfolios.length > 1 && portfolioId ? { portfolioId } : {}),
      ...(gradeable ? gradingPayload(grading) : {}),
      // NM är schemats default — skickas ändå, så servern aldrig behöver gissa.
      ...(gradeable ? { condition } : {}),
      // Bara när användaren bytt tryckning; annars sparas produkten arket öppnades för.
      ...(selectedOption && selectedOption.productId !== variantOptions[0]?.productId
        ? { productId: selectedOption.productId }
        : {}),
    });
  }

  const ctaSummary = [
    t("quickAddConfirm"),
    ...(gradeable && conditionPrice?.ore != null ? [formatPrice(conditionPrice.ore)] : []),
    ...(gradeable ? [tCond(condition)] : []),
  ].join(" · ");

  return (
    <BottomSheet
      open={open}
      title={t("quickAddTitle")}
      onClose={onClose}
      closeLabel={t("quickAddCancel")}
      panelClassName={panelClassName}
      footer={
        <BottomSheetCta onClick={confirm} disabled={saving}>
          {ctaSummary}
        </BottomSheetCta>
      }
    >
      {productTitle && <p className="mb-3 line-clamp-2 text-xs text-ink-faint">{productTitle}</p>}

      {/* TRYCKNING + SKICK FÖRST (2026-10-23): det är vad posten ÄR, antal och pris kommer sen. */}
      {gradeable && variantOptions.length > 1 && (
        <div className="mb-4">
          <p className="mb-1.5 text-sm text-ink">{t("quickAddVariant")}</p>
          <div className="flex flex-wrap gap-2">
            {variantOptions.map((o) => (
              <SheetChip
                key={o.productId}
                active={(selectedOption?.productId ?? null) === o.productId}
                onClick={() => setVariantId(o.productId)}
              >
                {o.label ?? tDetail("baseVersion")}
              </SheetChip>
            ))}
          </div>
        </div>
      )}

      {gradeable && (
        <div className="mb-4">
          <p className="mb-1.5 text-sm text-ink">{t("quickAddCondition")}</p>
          <div className="grid grid-cols-3 gap-2">
            {PRICED_CONDITIONS.map((c) => {
              const row = showConditionPrices
                ? priceForCondition(selectedOption!.conditionPrices, c, selectedOption!.headlinePrice)
                : null;
              return (
                <SheetChip key={c} active={condition === c} onClick={() => setCondition(c)} stacked>
                  <span>{tCond(c)}</span>
                  {showConditionPrices && (
                    <span className={cn("text-[11px] font-normal tabular-nums", condition === c ? "text-surface/80" : "text-ink-faint")}>
                      {row?.ore != null ? formatPrice(row.ore) : "–"}
                    </span>
                  )}
                </SheetChip>
              );
            })}
          </div>
          {showConditionPrices && conditionPrice && (
            <p className="mt-1.5 text-xs text-ink-faint">
              {conditionPrice.source === "headline"
                ? t("quickAddConditionMarket")
                : conditionPrice.source === "cardtrader"
                  ? t("quickAddConditionCt", { count: conditionPrice.n })
                  : t("quickAddConditionNone")}
            </p>
          )}
        </div>
      )}
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

      {gradeable && (
        <div className="mt-4">
          <p className="mb-1.5 text-sm text-ink">{t("quickAddGrading")}</p>
          <GradingPicker value={grading} onChange={setGrading} size="sm" />
        </div>
      )}

      {portfolios.length > 1 && (
        <div className="mt-4">
          <p className="mb-1.5 text-sm text-ink">{t("quickAddPortfolio")}</p>
          <PortfolioChips
            portfolios={portfolios}
            value={portfolioId}
            onChange={(id) => {
              setPortfolioId(id);
              if (id) setLastPortfolioId(id);
            }}
            onCreate={() => setCreateOpen(true)}
            size="sm"
            className="flex-wrap"
          />
        </div>
      )}
      <PortfolioCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setPortfolios((prev) => [...prev, created]);
          setPortfolioId(created.id);
          setLastPortfolioId(created.id);
        }}
      />
    </BottomSheet>
  );
}

/** Valchip i arket — samma form som graderingens chips (44 px tumyta). */
function SheetChip({
  active,
  onClick,
  stacked = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Två rader (skick + pris) i stället för en. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
        stacked
          ? "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-2 leading-tight"
          : "rounded-full px-3 py-1.5",
        active ? "bg-holo-cyan text-surface" : "bg-surface-overlay text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
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
