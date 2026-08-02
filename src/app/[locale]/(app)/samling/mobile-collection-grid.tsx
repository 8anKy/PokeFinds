"use client";

/**
 * Mobilens samlings-rutnät (app-känsla):
 *  - Tryck på ett objekt → öppna produktsidan (inspektera, precis som i Utforska).
 *  - Håll inne (long-press) ELLER tryck "Välj" → väljläge: bocka i flera objekt och
 *    radera dem på en gång. Radering går mot DELETE /api/collection/{id}.
 *  - Tryck på vinstraden (eller "Lägg till köppris") → sätt/ändra köppris. Mobilen är
 *    appens huvudyta men saknade helt redigering, så köppriset gick bara att sätta från
 *    desktop-tabellen — och utan köppris kan ingen vinst räknas.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { formatPrice, formatPercent } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, FieldError } from "@/components/ui/input";
import { IconCheck, IconPackage, IconTrash, IconX } from "@/components/ui/icons";
import { openProductOverlay } from "@/lib/product-overlay-open";
import type { CollectionRow } from "./collection-client";
import { parseKronorToOre } from "@/lib/purchase-price";
import { oreToKr, profitToneClass, rowProfit } from "./profit";
import { SellButton } from "./sell-on-tradera";

const LONG_PRESS_MS = 450;

export function MobileCollectionGrid({ rows }: { rows: CollectionRow[] }) {
  const t = useTranslations("Collection");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { toast } = useToast();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Stackad post (quantity>1) som ska delvis tas bort → fråga hur många.
  const [removeTarget, setRemoveTarget] = useState<CollectionRow | null>(null);
  const [removeQty, setRemoveQty] = useState("1");
  // Köppris-redigering (per post, i kronor — lagras i öre).
  const [priceTarget, setPriceTarget] = useState<CollectionRow | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const startPress = useCallback(
    (id: string) => {
      longPressed.current = false;
      pressTimer.current = window.setTimeout(() => {
        longPressed.current = true;
        setSelectMode(true);
        setSelected((prev) => new Set(prev).add(id));
      }, LONG_PRESS_MS);
    },
    []
  );

  const cancelPress = useCallback(() => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(
    (row: CollectionRow) => {
      if (longPressed.current) {
        longPressed.current = false;
        return; // long-press hanterades redan (gick in i väljläge)
      }
      if (selectMode) {
        toggle(row.id);
        return;
      }
      if (row.slug) {
        // Öppna overlayn (svep-tillbaka funkar) — på touch. Faller tillbaka på
        // vanlig nav om overlayn inte är tillgänglig (desktop).
        if (!openProductOverlay(row.slug)) router.push(`/produkter/${row.slug}`);
      } else {
        toast({
          title: t("gridNoProductTitle"),
          description: t("gridNoProductDesc"),
          variant: "error",
        });
      }
    },
    [router, selectMode, toggle, toast, t]
  );

  async function deleteSelected() {
    if (selected.size === 0) return;
    // Exakt en stackad post vald → fråga hur många som ska tas bort istället för allt.
    if (selected.size === 1) {
      const only = rows.find((r) => r.id === [...selected][0]);
      if (only && only.quantity > 1) {
        setRemoveQty("1");
        setRemoveTarget(only);
        return;
      }
    }
    if (!window.confirm(t("gridConfirmDelete", { count: selected.size }))) return;
    setDeleting(true);
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await apiFetch(`/api/collection/${id}`, { method: "DELETE" });
        ok += 1;
      } catch {
        /* fortsätt med nästa */
      }
    }
    setDeleting(false);
    exitSelect();
    toast({
      title: ok === ids.length ? t("gridDeletedTitle") : t("gridPartialTitle"),
      description:
        ok === ids.length
          ? t("gridDeletedDesc", { count: ok })
          : t("gridPartialDesc", { ok, total: ids.length }),
      variant: ok === ids.length ? "success" : "error",
    });
    router.refresh();
  }

  // Ta bort N av en stack: N<antal → minska quantity, N>=antal → radera hela posten.
  async function confirmRemove() {
    if (!removeTarget) return;
    const max = removeTarget.quantity;
    const n = Math.min(max, Math.max(1, Math.floor(Number(removeQty)) || 1));
    setDeleting(true);
    try {
      if (n >= max) {
        await apiFetch(`/api/collection/${removeTarget.id}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/collection/${removeTarget.id}`, {
          method: "PATCH",
          body: { quantity: max - n },
        });
      }
      toast({ title: t("gridDeletedTitle"), description: t("gridRemovedDesc", { count: n, total: max }), variant: "success" });
    } catch {
      toast({ title: t("gridPartialTitle"), variant: "error" });
    } finally {
      setDeleting(false);
      setRemoveTarget(null);
      exitSelect();
      router.refresh();
    }
  }

  function openPriceEditor(row: CollectionRow) {
    setPriceTarget(row);
    // Förifyll med befintligt köppris i kronor (komma som decimaltecken, som svenskar skriver).
    setPriceInput(oreToKr(row.purchasePrice));
    setPriceError(null);
  }

  // Sparar köppris i ÖRE. Tomt fält = nolla priset igen (posten faller då ur vinsten
  // i stället för att ligga kvar med ett felinmatat värde).
  async function savePurchasePrice() {
    if (!priceTarget) return;
    const parsed = parseKronorToOre(priceInput);
    if (parsed.kind === "invalid") {
      setPriceError(t("priceInvalidError"));
      return;
    }
    setSavingPrice(true);
    try {
      await apiFetch(`/api/collection/${priceTarget.id}`, {
        method: "PATCH",
        body: { purchasePrice: parsed.kind === "ok" ? parsed.ore : null },
      });
      toast({ title: t("updatedToast"), variant: "success" });
      setPriceTarget(null);
      router.refresh();
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSavingPrice(false);
    }
  }

  return (
    <section className="lg:hidden">
      {/* Sektionshuvud / väljlägets verktygsrad */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {selectMode ? (
          <>
            <button
              type="button"
              onClick={exitSelect}
              className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <IconX size={16} /> {t("gridSelectCancel")}
            </button>
            <span className="text-sm font-semibold text-ink">{t("gridSelected", { count: selected.size })}</span>
            <Button
              variant="danger"
              size="sm"
              onClick={deleteSelected}
              loading={deleting}
              disabled={selected.size === 0}
            >
              <IconTrash size={16} /> {t("gridDelete")}
            </Button>
          </>
        ) : (
          <>
            <h2 className="font-display text-xl font-bold text-ink">{t("gridYourCollection")}</h2>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="text-sm font-semibold text-holo-cyan hover:underline"
            >
              {t("gridSelect")}
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {rows.map((r) => {
          const isSelected = selected.has(r.id);
          const profit = rowProfit(r);
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => handleClick(r)}
              onPointerDown={() => startPress(r.id)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              className={`card-surface relative flex flex-col gap-2 p-3 text-left transition-colors ${
                isSelected ? "border-holo-cyan ring-1 ring-holo-cyan" : ""
              }`}
            >
              {/* Markering i väljläget */}
              {selectMode && (
                <span
                  className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-holo-cyan bg-holo-cyan text-black"
                      : "border-surface-border bg-surface/80 text-transparent"
                  }`}
                >
                  <IconCheck size={14} />
                </span>
              )}
              {/* Bildbrunnen är SVART som resten av kortet — exakt samma behandling som
                  Utforska-kortet (product-card.tsx). `surface-overlay` är en INTERAKTIV
                  fyllning (hover, flikar, skeletons), inte en bakgrund: som brunn lyste
                  den som en grå ruta bakom varje bild och fick hela portföljen att läsa
                  som en annan yta än katalogen. Saknad bild → ikonen bär platshållaren. */}
              <div className="h-28 w-full overflow-hidden rounded-lg bg-surface">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <IconPackage size={26} />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                {r.setName && <p className="truncate text-xs text-ink-muted">{r.setName}</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {r.estimatedValue != null ? formatPrice(r.estimatedValue) : "–"}
                </span>
                {r.quantity > 1 && <span className="text-xs text-ink-muted">{t("pieces", { count: r.quantity })}</span>}
              </div>
              {/* Vinst/förlust — belopp först, procent som stöd. Saknas köppris visas en
                  uppmaning i stället: det är enda sättet posten kan komma med i totalen.
                  Knappen stoppar bubblingen så kortets "öppna produkt"-tryck inte utlöses. */}
              {!selectMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPriceEditor(r);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`-mx-1 rounded px-1 py-0.5 text-left text-xs font-semibold tabular-nums transition-colors hover:bg-surface-overlay/50 ${
                    profit ? profitToneClass(profit.amount) : "text-holo-cyan"
                  }`}
                >
                  {profit ? (
                    <>
                      {profit.amount > 0 ? "+" : ""}
                      {formatPrice(profit.amount)}
                      {profit.percent != null && (
                        <span className="ml-1 font-normal opacity-80">
                          ({formatPercent(profit.percent)})
                        </span>
                      )}
                    </>
                  ) : (
                    t("gridAddPurchasePrice")
                  )}
                </button>
              )}
              {!selectMode && (
                <span
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <SellButton row={r} className="w-full" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Modal
        open={removeTarget != null}
        onClose={() => setRemoveTarget(null)}
        title={t("gridRemoveTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              {t("gridSelectCancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmRemove()} loading={deleting}>
              <IconTrash size={16} /> {t("gridDelete")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmRemove();
          }}
        >
          <p className="mb-3 truncate text-sm font-medium text-ink">{removeTarget?.name}</p>
          <Label htmlFor="removeQty">{t("gridRemoveLabel", { max: removeTarget?.quantity ?? 1 })}</Label>
          <Input
            id="removeQty"
            type="number"
            inputMode="numeric"
            min={1}
            max={removeTarget?.quantity ?? 1}
            step={1}
            value={removeQty}
            onChange={(e) => setRemoveQty(e.target.value)}
            autoFocus
          />
        </form>
      </Modal>

      {/* Köppris — samma Modal+Input-mönster som borttagningsdialogen ovan. */}
      <Modal
        open={priceTarget != null}
        onClose={() => setPriceTarget(null)}
        title={t("gridPurchasePriceTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPriceTarget(null)}>
              {t("gridSelectCancel")}
            </Button>
            <Button onClick={() => void savePurchasePrice()} loading={savingPrice}>
              {tc("save")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePurchasePrice();
          }}
        >
          <p className="mb-3 truncate text-sm font-medium text-ink">{priceTarget?.name}</p>
          <Label htmlFor="purchasePriceKr">{t("purchasePrice")}</Label>
          <Input
            id="purchasePriceKr"
            inputMode="decimal"
            placeholder={t("purchasePricePlaceholder")}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            autoFocus
          />
          <p className="mt-2 text-xs text-ink-muted">{t("gridPurchasePriceHint")}</p>
          <FieldError message={priceError} />
        </form>
      </Modal>
    </section>
  );
}
