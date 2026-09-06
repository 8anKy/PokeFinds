"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { alertCopyKey } from "@/lib/alert-copy";
import { priceAlertsPausedClient } from "@/lib/price-alerts-pause";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";
import { IconCheck, IconLock, IconPackage, IconTrendingDown } from "@/components/ui/icons";
import { ProTextLink } from "@/components/features/pro-cta";

/** Den bevakningsrad produktsidan känner till — det arket redigerar. */
export interface ProductWatchState {
  id: string;
  priceAlert: boolean;
  restockAlert: boolean;
  /** Öre, eller null när inget målpris är satt. */
  targetPrice: number | null;
}

export interface ProductWatchInput {
  priceAlert: boolean;
  restockAlert: boolean;
  targetPrice: number | null;
}

interface ProductWatchSheetProps {
  open: boolean;
  onClose: () => void;
  productTitle: string;
  /** Null = produkten bevakas inte ännu → arket skapar; annars redigerar det. */
  current: ProductWatchState | null;
  /** Gratiskonto → larmen är låsta (Pro-förmån), produkten sparas ändå. */
  isPro: boolean;
  saving: boolean;
  onSave: (input: ProductWatchInput) => void;
  onRemove: () => void;
}

/**
 * ETT ark för hela bevakningen av en produkt (ägarbeslut 2026-09-06).
 *
 * Förut låg "Bevaka pris" och "Bevaka restock" som två knappar — men båda
 * skriver till SAMMA rad (`@@unique([userId, productId])` med flaggorna
 * `priceAlert`/`restockAlert` + ett målpris), så den andra knappen svarade 409
 * "bevakas redan". Här väljer man båda i ett svep, ändrar dem senare på samma
 * ställe och kan sluta bevaka utan att gå till Bevakningar (samma ark bakom
 * "Bevakas"-knappen).
 *
 * ⛔ PAUSERNA ÄR COPY, INTE LÅS: en pausad larmtyp går fortfarande att välja
 * (raden sparas och larmar när pausen hävs — precis som det gamla målpris-
 * fönstret gjorde), men hinten SÄGER att den är pausad. Vaktat av
 * price-alert-pause.test.ts / restock-pause-copy.test.ts.
 *
 * Gratiskonto: raderna är låsta med Pro-länk i arket (inte under knapparna som
 * förut) och knappen sparar produkten utan larmflaggor — samma val som förut,
 * men på ett ställe. ⛔ Ingen Pro-uppsäljning om låset beror på en paus.
 */
export function ProductWatchSheet({
  open,
  onClose,
  productTitle,
  current,
  isPro,
  saving,
  onSave,
  onRemove,
}: ProductWatchSheetProps) {
  const t = useTranslations("Detail");
  const pricePaused = priceAlertsPausedClient();
  const restockPaused = restockAlertsPausedClient();

  const [priceOn, setPriceOn] = useState(true);
  const [restockOn, setRestockOn] = useState(true);
  const [target, setTarget] = useState("");
  const [invalid, setInvalid] = useState(false);

  // Utgångsläget läses in varje gång arket öppnas: den sparade raden om den
  // finns, annars båda larmen på (databasens default) och tomt målpris.
  useEffect(() => {
    if (!open) return;
    setPriceOn(current?.priceAlert ?? true);
    setRestockOn(current?.restockAlert ?? true);
    setTarget(current?.targetPrice != null ? String(current.targetPrice / 100) : "");
    setInvalid(false);
  }, [open, current]);

  const locked = !isPro;

  function submit() {
    if (locked) {
      onSave({ priceAlert: false, restockAlert: false, targetPrice: null });
      return;
    }
    let targetPrice: number | null = null;
    const trimmed = target.trim();
    if (priceOn && trimmed) {
      const kr = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(kr) || kr < 0) {
        setInvalid(true);
        return;
      }
      targetPrice = Math.round(kr * 100);
    }
    onSave({ priceAlert: priceOn, restockAlert: restockOn, targetPrice });
  }

  // Gratiskonto som redan sparat produkten: det enda arket kan göra är att ta
  // bort den — så säger knappen det, i stället för ett "Spara" som inte sparar.
  const ctaRemoves = locked && current !== null;

  return (
    <BottomSheet
      open={open}
      title={t("watchSheetTitle")}
      onClose={onClose}
      closeLabel={t("watchSheetClose")}
      panelClassName="sm:mx-auto sm:max-w-md"
      footer={
        <BottomSheetCta onClick={ctaRemoves ? onRemove : submit} disabled={saving}>
          {ctaRemoves ? t("watchSheetRemove") : current ? t("watchSheetSave") : t("watchCta")}
        </BottomSheetCta>
      }
    >
      <p className="mb-3 line-clamp-2 text-xs text-ink-faint">{productTitle}</p>

      <div className="flex flex-col gap-2">
        <AlertOption
          on={priceOn}
          locked={locked}
          icon={<IconTrendingDown size={18} />}
          label={t("watchPriceOption")}
          hint={t(alertCopyKey("watchPriceOptionHint", pricePaused))}
          onToggle={() => setPriceOn((v) => !v)}
        >
          {priceOn && !locked && (
            <div className="mt-3">
              <Label htmlFor="watchTargetPrice">{t("targetPriceLabel")}</Label>
              <Input
                id="watchTargetPrice"
                inputMode="decimal"
                placeholder={t("targetPricePlaceholder")}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setInvalid(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                aria-invalid={invalid || undefined}
              />
              <p className={cn("mt-1.5 text-xs", invalid ? "text-fall" : "text-ink-faint")}>
                {invalid ? t("invalidPriceDesc") : t("targetPriceOptional")}
              </p>
            </div>
          )}
        </AlertOption>

        <AlertOption
          on={restockOn}
          locked={locked}
          icon={<IconPackage size={18} />}
          label={t("watchRestockOption")}
          hint={t(alertCopyKey("watchRestockOptionHint", restockPaused))}
          onToggle={() => setRestockOn((v) => !v)}
        />
      </div>

      {locked && (
        <p className="mt-3 text-xs leading-snug text-ink-faint">
          {t("watchSheetProHint")}{" "}
          {/* ⛔ Ingen Pro-länk när prislarmen är pausade — samma grind som
              set-arket: skicka ingen till kassan för något vi stängt av. */}
          {!pricePaused && (
            <ProTextLink source="product-watch-sheet" className="font-medium text-holo-cyan hover:underline">
              {t("alertsProCta")}
            </ProTextLink>
          )}
        </p>
      )}

      {/* Sluta bevaka — härifrån, inte via Bevakningar-fliken (ägaren 2026-09-06). */}
      {current && !ctaRemoves && (
        <button
          type="button"
          onClick={onRemove}
          disabled={saving}
          className="mt-4 w-full rounded-lg py-2.5 text-sm font-medium text-fall transition-colors hover:bg-fall/10 disabled:opacity-50"
        >
          {t("watchSheetRemove")}
        </button>
      )}
    </BottomSheet>
  );
}

/** En larmtyp i arket — en växel i samma form som set-arkets val. */
function AlertOption({
  on,
  locked,
  icon,
  label,
  hint,
  onToggle,
  children,
}: {
  on: boolean;
  locked: boolean;
  icon: ReactNode;
  label: string;
  hint: string;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const active = on && !locked;
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        active ? "border-holo-cyan bg-holo-cyan/10" : "border-surface-border bg-surface",
        locked && "opacity-60"
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={active}
        disabled={locked}
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className={cn("mt-0.5 shrink-0", active ? "text-holo-cyan" : "text-ink-faint")}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{label}</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-faint">{hint}</span>
        </span>
        {locked ? (
          <IconLock size={15} className="mt-0.5 shrink-0 text-ink-faint" />
        ) : (
          <span
            aria-hidden
            className={cn(
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
              active ? "border-holo-cyan bg-holo-cyan text-surface" : "border-surface-border"
            )}
          >
            {active && <IconCheck size={13} strokeWidth={2.5} />}
          </span>
        )}
      </button>
      {children}
    </div>
  );
}
