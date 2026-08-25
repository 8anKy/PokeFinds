"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";
import { IconBell, IconBellFilled, IconCards, IconCheck, IconLock } from "@/components/ui/icons";

export type WatchScope = "item" | "set";

interface WatchBellSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (scope: WatchScope) => void;
  productTitle: string;
  /** Null = produkten har inget set ännu → set-valet visas inte alls. */
  setName: string | null;
  /** Bevakas setet redan? Då är valet "sluta bevaka setet". */
  setWatched: boolean;
  itemWatched: boolean;
  /** Gratiskonto → set-valet är låst och leder till prissidan. */
  isPro: boolean;
}

/**
 * Valet bakom långtrycket på klockan: bevaka VARAN eller HELA SETET.
 *
 * Samma bottenark som snabbtillägget bakom "+" (ägarbeslut 2026-08-02: appens
 * "välj och bekräfta"-form). ⛔ Bygg ingen popover ankrad vid klockan — klockan
 * sitter i ett kort med `overflow-hidden` och `transform`, exakt den situation
 * som gjorde att snabbtilläggets popover ritades INUTI kortet.
 *
 * Set-valet SAKNAS helt när produkten inte har något set (färska auto-importer
 * får sitt setId först av nattens sealed-import). Ett låst val vi inte kan uppfylla
 * är sämre än inget val: det ser ut som en Pro-spärr fast det är en datalucka.
 */
export function WatchBellSheet({
  open,
  onClose,
  onConfirm,
  productTitle,
  setName,
  setWatched,
  itemWatched,
  isPro,
}: WatchBellSheetProps) {
  const t = useTranslations("Watch");
  // Förvalet är varan: det är vad ett kort tryck gör, så hållet börjar där
  // fingret hade hamnat ändå och blir ett tillägg, inte ett omval.
  const [scope, setScope] = useState<WatchScope>("item");
  /**
   * ⛔ KLOCKAN RENDERAS BARA FÖR SEALED och skapar BARA ett restock-larm
   * (`priceAlert: false` i watch-bell.tsx). Under pausen sparar den alltså
   * produkten men larmar aldrig — hinten måste säga det, annars är arket ett
   * löfte. Set-valet låses helt: det ÄR restock-larmen och inget annat.
   */
  const restockPaused = restockAlertsPausedClient();
  const setLocked = !isPro || restockPaused;
  const chosen = scope === "set" && setLocked ? "item" : scope;

  return (
    <BottomSheet
      open={open}
      title={t("sheetTitle")}
      onClose={onClose}
      closeLabel={t("close")}
      // Knappen säger vad bekräftelsen GÖR: är det valda redan på stänger den av
      // det. "Bevaka" på något som redan bevakas hade läst som att inget händer.
      footer={
        <BottomSheetCta onClick={() => onConfirm(chosen)}>
          {(chosen === "set" ? setWatched : itemWatched) ? t("confirmRemove") : t("confirm")}
        </BottomSheetCta>
      }
    >
      <p className="mb-3 line-clamp-2 text-xs text-ink-faint">{productTitle}</p>

      <div className="flex flex-col gap-2">
        <ScopeOption
          selected={chosen === "item"}
          watched={itemWatched}
          icon={itemWatched ? <IconBellFilled size={18} /> : <IconBell size={18} />}
          label={t("scopeItem")}
          hint={
            itemWatched
              ? t("scopeItemRemove")
              : restockPaused
                ? t("scopeItemPaused")
                : t("scopeItemHint")
          }
          onSelect={() => setScope("item")}
        />

        {setName && (
          <ScopeOption
            selected={chosen === "set"}
            watched={setWatched}
            locked={setLocked}
            icon={<IconCards size={18} />}
            label={t("scopeSet", { set: setName })}
            hint={
              restockPaused
                ? t("scopeSetPaused")
                : setLocked
                  ? t("scopeSetPro")
                  : setWatched
                    ? t("scopeSetRemove")
                    : t("scopeSetHint")
            }
            onSelect={() => !setLocked && setScope("set")}
          />
        )}
      </div>

      {/* ⛔ Ingen Pro-uppsäljning när låset beror på PAUSEN. Att skicka någon
          till kassan för en funktion vi stängt av är precis det felet den här
          grinden finns för. */}
      {setName && setLocked && !restockPaused && (
        <Link
          href="/priser"
          className="mt-3 block text-xs font-medium text-holo-cyan hover:underline"
        >
          {t("proCta")}
        </Link>
      )}
    </BottomSheet>
  );
}

function ScopeOption({
  selected,
  watched,
  locked,
  icon,
  label,
  hint,
  onSelect,
}: {
  selected: boolean;
  /** Redan påslaget → egen markering, så raden inte läser som "lägg till". */
  watched?: boolean;
  locked?: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      aria-pressed={selected}
      className={cn(
        // 44px minsta höjd via py — arket är en tumyta.
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-holo-cyan bg-holo-cyan/10"
          : "border-surface-border bg-surface hover:bg-surface-border/40",
        locked && "opacity-60"
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          watched || selected ? "text-holo-cyan" : "text-ink-faint"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-faint">{hint}</span>
      </span>
      {locked ? (
        <IconLock size={15} className="mt-0.5 shrink-0 text-ink-faint" />
      ) : (
        selected && <IconCheck size={16} className="mt-0.5 shrink-0 text-holo-cyan" />
      )}
    </button>
  );
}
