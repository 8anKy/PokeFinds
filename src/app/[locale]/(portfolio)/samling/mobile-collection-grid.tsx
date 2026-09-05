"use client";

/**
 * Mobilens samlings-rutnät (app-känsla):
 *  - Tryck på ett objekt → öppna produktsidan (inspektera, precis som i Utforska).
 *  - Håll inne (long-press) ELLER tryck "Välj" → väljläge: bocka i flera objekt och
 *    radera dem på en gång. Radering går mot DELETE /api/collection/{id}.
 *  - Tryck på vinstraden (eller "Lägg till köppris") → sätt/ändra köppris. Mobilen är
 *    appens huvudyta men saknade helt redigering, så köppriset gick bara att sätta från
 *    desktop-tabellen — och utan köppris kan ingen vinst räknas.
 *
 * POSTER (LOTS): samma vara köpt flera gånger till olika pris ligger som FLERA rader i
 * databasen. Rutnätet visar EN ruta per vara med totalantal + snittpris och en
 * utfällare för de enskilda köpen. Grupper med ETT köp — den absoluta merparten —
 * renderas exakt som förut: ingen chevron, ingen snittrad, ingen extra krom.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { formatPrice, formatPercent, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, FieldError } from "@/components/ui/input";
import { IconCheck, IconChevronDown, IconPackage, IconTrash, IconX } from "@/components/ui/icons";
import { openProductOverlay } from "@/lib/product-overlay-open";
import type { CollectionRow } from "./collection-client";
import { parseKronorToOre } from "@/lib/purchase-price";
import {
  groupCollectionLots,
  groupProfit,
  groupUnitValue,
  oreToKr,
  profitToneClass,
  rowProfit,
} from "./profit";
import {
  DEFAULT_COLLECTION_SORT,
  filterCollectionRows,
  sortCollectionGroups,
  type CollectionSort,
} from "./collection-filter";
import { CollectionToolbar } from "./collection-toolbar";
import { SellButton } from "./sell-on-tradera";

const LONG_PRESS_MS = 450;

export function MobileCollectionGrid({ rows }: { rows: CollectionRow[] }) {
  const t = useTranslations("Collection");
  const locale = useLocale();
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

  // Utfällda grupper (nyckel från groupLots). Rent lokalt state — INGA URL-parametrar:
  // sidan får inte bli beroende av searchParams (se Caching/ISR i CLAUDE.md).
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  // Sök + sortering. Samma regel: lokalt state, ingen URL, ingen ny hämtning —
  // raderna finns redan i minnet (se collection-filter.ts).
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CollectionSort>(DEFAULT_COLLECTION_SORT);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const panelIdBase = useId();

  // En ruta per VARA. Poster utan pris räknas aldrig in i snittet — groupLots
  // rapporterar costedQuantity så gränssnittet kan säga hur många snittet gäller.
  const allGroups = useMemo(() => groupCollectionLots(rows), [rows]);

  // FILTRERA POSTER → GRUPPERA → SORTERA GRUPPER. Grupperingen måste ske EFTER
  // filtreringen (den bygger på poster, aldrig på namn) och sorteringen på
  // grupperna (det är dem rutnätet ritar). Tom sökning återanvänder den redan
  // grupperade listan — filterCollectionRows returnerar då samma referens.
  const groups = useMemo(() => {
    const filtered = filterCollectionRows(rows, query);
    const base = filtered === rows ? allGroups : groupCollectionLots(filtered);
    return sortCollectionGroups(base, sort);
  }, [rows, allGroups, query, sort]);

  const filterActive = query.trim().length > 0;

  // Markeringen gäller alltid ENSKILDA poster (det är dem API:t raderar). En grupp
  // markeras genom att alla dess poster markeras — allt-eller-inget, så ett andra
  // tryck på rutan tömmer den igen i stället för att låsa sig i "delvis vald".
  const toggleMany = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const startPress = useCallback(
    (ids: readonly string[]) => {
      longPressed.current = false;
      pressTimer.current = window.setTimeout(() => {
        longPressed.current = true;
        setSelectMode(true);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
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
    (lots: readonly CollectionRow[]) => {
      const row = lots[0];
      if (longPressed.current) {
        longPressed.current = false;
        return; // long-press hanterades redan (gick in i väljläge)
      }
      if (selectMode) {
        toggleMany(lots.map((l) => l.id));
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
    [router, selectMode, toggleMany, toast, t]
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

      {/* Sök + sortering. Göms i VÄLJLÄGET med flit: markeringen gäller poster,
          och ett filter som ändras mitt i ett urval hade dolt vad man raderar. */}
      {!selectMode && (
        <CollectionToolbar
          idPrefix="m-collection"
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          matchCount={groups.length}
          totalCount={allGroups.length}
          className="mb-3"
        />
      )}

      {/* Tomläge för filtret — samlingen är inte tom, sökningen träffade bara
          ingenting, så vägen ut är att rensa den (inte att lägga till kort). */}
      {filterActive && groups.length === 0 && (
        <div className="card-surface flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="text-ink-faint">
            <IconPackage size={26} />
          </span>
          <p className="text-sm font-medium text-ink">
            {t("filterNoMatchTitle", { query: query.trim() })}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
            {t("filterClear")}
          </Button>
        </div>
      )}

      {/* Rutnätet renderas alltid; är listan tom ritas ingenting (tomläget ovan
          bär beskedet), så resten av filen står kvar orörd. */}
      <div className="grid grid-cols-2 gap-3">
        {groups.map((g, index) => {
          const r = g.lots[0];
          const multi = g.lots.length > 1;
          const ids = g.lots.map((l) => l.id);
          const isSelected = ids.every((id) => selected.has(id));
          const anySelected = ids.some((id) => selected.has(id));
          // Ensam post → EXAKT dagens siffror (groupUnitValue/groupProfit reducerar
          // till rowProfit när gruppen bara har ett köp), så den vanliga rutan är
          // oförändrad. Flera köp → gruppens tal.
          const unitValue = groupUnitValue(g.lots);
          const profit = multi ? groupProfit(g.lots) : rowProfit(r);
          const quantity = multi ? g.quantity : r.quantity;
          // I väljläget vecklas grupper ALLTID ut: markeringen gäller enskilda poster
          // och en hopfälld grupp hade dolt vad man faktiskt raderar.
          const open = openKeys.has(g.key) || (multi && selectMode);
          const panelId = `${panelIdBase}-lots-${index}`;
          // Snittet får ALDRIG läsas som att det gäller alla exemplar. Täcker det bara
          // en del av dem säger etiketten det rakt ut ("snitt 400 kr · 1 av 4"), och
          // saknas pris helt står det att priset saknas — aldrig "0 kr".
          const avgLabel = !multi
            ? null
            : g.averagePaid == null
              ? t("lotAvgUnknown")
              : g.costedQuantity < g.quantity
                ? t("lotAvgPartial", {
                    price: formatPrice(g.averagePaid),
                    costed: g.costedQuantity,
                    total: g.quantity,
                  })
                : t("lotAvgPaid", { price: formatPrice(g.averagePaid) });
          return (
            <div
              key={g.key}
              role="button"
              tabIndex={0}
              onClick={() => handleClick(g.lots)}
              onPointerDown={() => startPress(ids)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              className={`card-surface relative flex flex-col gap-2 p-3 text-left transition-colors ${
                anySelected ? "border-holo-cyan ring-1 ring-holo-cyan" : ""
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
                  {unitValue != null ? formatPrice(unitValue) : "–"}
                </span>
                {quantity > 1 && <span className="text-xs text-ink-muted">{t("pieces", { count: quantity })}</span>}
              </div>
              {/* Snittraden finns BARA när varan köpts flera gånger — en ensam post har
                  inget snitt att tala om, och kortet ska då se ut precis som förut. */}
              {avgLabel && !selectMode && (
                <p className="truncate text-xs text-ink-muted">{avgLabel}</p>
              )}
              {/* Vinst/förlust — belopp först, procent som stöd. Saknas köppris visas en
                  uppmaning i stället: det är enda sättet posten kan komma med i totalen.
                  Knappen stoppar bubblingen så kortets "öppna produkt"-tryck inte utlöses.
                  ⛔ För en GRUPP är knappen en ren text: "sätt köppris" är en åtgärd på
                  EN post, och gruppen vet inte vilken — köpen redigeras i utfällningen. */}
              {!selectMode && multi && profit && (
                <span
                  className={`text-xs font-semibold tabular-nums ${profitToneClass(profit.amount)}`}
                  title={
                    g.costedQuantity < g.quantity
                      ? t("lotProfitPartialHint", { costed: g.costedQuantity, total: g.quantity })
                      : undefined
                  }
                >
                  {profit.amount > 0 ? "+" : ""}
                  {formatPrice(profit.amount)}
                  {profit.percent != null && (
                    <span className="ml-1 font-normal opacity-80">({formatPercent(profit.percent)})</span>
                  )}
                </span>
              )}
              {!selectMode && !multi && (
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
              {/* Sälj-knappen gäller EN post (annonsen får ett köppris ur just den).
                  Med flera köp flyttar den därför in i utfällningen, en per post. */}
              {!selectMode && !multi && (
                <span
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <SellButton row={r} className="w-full" />
                </span>
              )}

              {/* Utfällaren — bara flera köp får den. Riktig <button> med aria-expanded
                  /aria-controls så den går att nå och förstå med tangentbord och skärmläsare. */}
              {multi && !selectMode && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(g.key);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="-mx-1 flex items-center justify-between gap-1 rounded px-1 py-0.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-surface-overlay/50 hover:text-ink"
                >
                  <span className="truncate">{t("lotCount", { count: g.lots.length })}</span>
                  <IconChevronDown
                    size={14}
                    className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
              )}

              {/* Köpen, ett per rad. Ligger kvar i DOM:en även hopfälld så aria-controls
                  alltid pekar på något — det är utfällaren som byter tillstånd, inte
                  målet som försvinner. */}
              {multi && (
                <ul
                  id={panelId}
                  className={`${open ? "" : "hidden"} space-y-2 border-t border-surface-border pt-2`}
                >
                  {g.lots.map((lot) => {
                    const lotSelected = selected.has(lot.id);
                    return (
                      <li key={lot.id} className="flex flex-col gap-1">
                        <button
                          type="button"
                          aria-pressed={selectMode ? lotSelected : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Väljläge → markera just den här posten. Annars → sätt/ändra
                            // DESS köppris (aldrig gruppens: priserna är olika, det är
                            // hela poängen med poster).
                            if (selectMode) toggleMany([lot.id]);
                            else openPriceEditor(lot);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`-mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight tabular-nums transition-colors hover:bg-surface-overlay/50 ${
                            selectMode && lotSelected ? "bg-holo-cyan/10 text-ink" : ""
                          }`}
                        >
                          {selectMode && (
                            <IconCheck
                              size={12}
                              className={`shrink-0 ${lotSelected ? "text-holo-cyan" : "text-ink-faint"}`}
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="text-ink">{t("pieces", { count: lot.quantity })}</span>
                            <span className="text-ink-muted"> · </span>
                            {/* Saknat pris är "–", ALDRIG 0 kr: noll betyder "fick gratis". */}
                            <span
                              className={
                                lot.purchasePrice != null ? "font-semibold text-ink" : "text-ink-faint"
                              }
                            >
                              {lot.purchasePrice != null ? formatPrice(lot.purchasePrice) : "–"}
                            </span>
                            <span className="block truncate text-ink-faint">
                              {formatDate(lot.purchaseDate, locale)}
                            </span>
                          </span>
                        </button>
                        {!selectMode && (
                          <span
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <SellButton row={lot} className="w-full" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
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
