"use client";

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { formatPrice, formatPercent, formatDate } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Textarea, Select, Label, Checkbox, FieldError } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  IconChevronDown,
  IconPackage,
  IconPlus,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";
import { SellButton } from "./sell-on-tradera";
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

export const CONDITION_LABELS: Record<string, string> = {
  MINT: "Mint",
  NEAR_MINT: "Near Mint",
  EXCELLENT: "Excellent",
  GOOD: "Good",
  PLAYED: "Played",
  POOR: "Poor",
  SEALED: "Sealed",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övrigt",
};

export interface CollectionRow {
  id: string;
  // Identiteten som avgör vilka POSTER som är samma vara (se lotKey i
  // @/lib/collection-lots). Utan dem kan gränssnittet inte gruppera köp — och de
  // får inte härledas ur namn/bild: två kort kan heta likadant.
  cardId: string | null;
  productId: string | null;
  name: string;
  slug: string | null; // produktsida att inspektera (singel → kortets billigaste produkt)
  imageUrl: string | null;
  setName: string | null;
  quantity: number;
  condition: string;
  language: string;
  purchasePrice: number | null; // öre
  purchaseDate: string | null; // ISO
  estimatedValue: number | null; // öre
  gradingCompany: string | null;
  grade: string | null;
  notes: string | null;
}

interface CardHit {
  id: string;
  name: string;
  number: string;
  set: { id: string; name: string } | null;
}

interface FormState {
  cardId: string;
  cardLabel: string;
  freeText: string;
  quantity: string;
  condition: string;
  language: string;
  purchasePrice: string; // kr
  purchaseDate: string;
  estimatedValue: string; // kr
  gradingCompany: string;
  grade: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  cardId: "",
  cardLabel: "",
  freeText: "",
  quantity: "1",
  condition: "NEAR_MINT",
  language: "EN",
  purchasePrice: "",
  purchaseDate: "",
  estimatedValue: "",
  gradingCompany: "",
  grade: "",
  notes: "",
};

export function CollectionClient({
  initialItems,
  isPublicCollection,
}: {
  initialItems: CollectionRow[];
  isPublicCollection: boolean;
}) {
  const t = useTranslations("Collection");
  const tCond = useTranslations("Condition");
  const tLang = useTranslations("Language");
  const tc = useTranslations("Common");
  const [items, setItems] = useState(initialItems);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionRow | null>(null);
  const [deleting, setDeleting] = useState<CollectionRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isPublic, setIsPublic] = useState(isPublicCollection);
  // Utfällda grupper. Lokalt state, INGA URL-parametrar (se Caching/ISR i CLAUDE.md).
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const rowIdBase = useId();

  // Filtrering + sortering av SAMLINGEN. Lokalt state, ingen URL-parameter och
  // ingen ny hämtning — raderna finns redan i minnet (se collection-filter.ts).
  // ⛔ Förväxla inte `filterQuery` med `search` längre ned: det senare är
  // KORTSÖKNINGEN i "Lägg till manuellt" och går mot /api/cards.
  const [filterQuery, setFilterQuery] = useState("");
  const [sort, setSort] = useState<CollectionSort>(DEFAULT_COLLECTION_SORT);

  // En tabellrad per VARA; flera köp av samma vara fälls ut som underrader.
  const allGroups = useMemo(() => groupCollectionLots(items), [items]);

  // FILTRERA POSTER → GRUPPERA → SORTERA GRUPPER. Grupperingen bygger på poster
  // (lotKey), aldrig på namnet, så den måste ske efter filtreringen; sorteringen
  // gäller grupperna, det är dem tabellen radar upp. Tom sökning återanvänder
  // den redan grupperade listan (samma array-referens tillbaka från filtret).
  const groups = useMemo(() => {
    const filtered = filterCollectionRows(items, filterQuery);
    const base = filtered === items ? allGroups : groupCollectionLots(filtered);
    return sortCollectionGroups(base, sort);
  }, [items, allGroups, filterQuery, sort]);

  const filterActive = filterQuery.trim().length > 0;

  function toggleGroup(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Kortsökning
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CardHit[]>([]);
  const [searching, setSearching] = useState(false);

  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<{ items: CardHit[] }>(
          `/api/cards?query=${encodeURIComponent(q)}&pageSize=8`
        );
        setHits(data.items);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload(f: FormState): Record<string, unknown> | { error: string } {
    const quantity = Number(f.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: t("qtyMinError") };
    }
    if (!f.cardId && !f.freeText.trim()) {
      return { error: t("chooseOrNameError") };
    }
    // Ogiltigt/negativt pris avvisas i stället för att tyst falla bort ur payloaden.
    const purchasePrice = parseKronorToOre(f.purchasePrice);
    const estimatedValue = parseKronorToOre(f.estimatedValue);
    if (purchasePrice.kind === "invalid" || estimatedValue.kind === "invalid") {
      return { error: t("priceInvalidError") };
    }
    const notes = f.cardId
      ? f.notes.trim() || undefined
      : [f.freeText.trim(), f.notes.trim()].filter(Boolean).join(" · ");
    return {
      ...(f.cardId ? { cardId: f.cardId } : {}),
      quantity,
      condition: f.condition,
      language: f.language,
      // Nya poster: BLANKT fält = utelämna nyckeln (POST tar inte emot null). 0 kr är
      // däremot ett äkta köppris och skickas med.
      ...(purchasePrice.kind === "ok" ? { purchasePrice: purchasePrice.ore } : {}),
      ...(estimatedValue.kind === "ok" ? { estimatedValue: estimatedValue.ore } : {}),
      ...(f.purchaseDate ? { purchaseDate: f.purchaseDate } : {}),
      gradingCompany: f.gradingCompany.trim() || undefined,
      grade: f.grade.trim() || undefined,
      ...(notes ? { notes } : {}),
    };
  }

  async function submitAdd() {
    const payload = buildPayload(form);
    if ("error" in payload && typeof payload.error === "string") {
      setFormError(payload.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch("/api/collection", { method: "POST", body: payload });
      toast({ title: t("addedToast"), variant: "success" });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      setSearch("");
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(item: CollectionRow) {
    setEditing(item);
    setForm({
      ...EMPTY_FORM,
      quantity: String(item.quantity),
      condition: item.condition,
      language: item.language,
      purchasePrice: oreToKr(item.purchasePrice),
      estimatedValue: oreToKr(item.estimatedValue),
      purchaseDate: item.purchaseDate ? item.purchaseDate.slice(0, 10) : "",
      gradingCompany: item.gradingCompany ?? "",
      grade: item.grade ?? "",
      notes: item.notes ?? "",
    });
    setFormError(null);
  }

  async function submitEdit() {
    if (!editing) return;
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setFormError(t("qtyMinError"));
      return;
    }
    const purchasePrice = parseKronorToOre(form.purchasePrice);
    const estimatedValue = parseKronorToOre(form.estimatedValue);
    if (purchasePrice.kind === "invalid" || estimatedValue.kind === "invalid") {
      setFormError(t("priceInvalidError"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/collection/${editing.id}`, {
        method: "PATCH",
        body: {
          quantity,
          condition: form.condition,
          language: form.language,
          // Köppris får NOLLAS (blankt fält → null) — ett felinmatat pris ska inte ligga
          // kvar och snedvrida vinsten. estimatedValue lämnas däremot orört när fältet är
          // tomt: det är en lagrad värde-ögonblicksbild som valueringen faller tillbaka på.
          purchasePrice: purchasePrice.kind === "ok" ? purchasePrice.ore : null,
          ...(estimatedValue.kind === "ok" ? { estimatedValue: estimatedValue.ore } : {}),
          ...(form.purchaseDate ? { purchaseDate: form.purchaseDate } : {}),
          ...(form.gradingCompany.trim() ? { gradingCompany: form.gradingCompany.trim() } : {}),
          ...(form.grade.trim() ? { grade: form.grade.trim() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        },
      });
      toast({ title: t("updatedToast"), variant: "success" });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("genericFail"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await apiFetch(`/api/collection/${deleting.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== deleting.id));
      toast({ title: t("deletedToast"), variant: "success" });
      router.refresh();
    } catch (e) {
      toast({
        title: t("deleteFailToast"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
      setDeleting(null);
    }
  }

  async function togglePublic(next: boolean) {
    setIsPublic(next);
    try {
      await apiFetch("/api/users/me", { method: "PATCH", body: { isPublicCollection: next } });
      toast({
        title: next ? t("nowPublicToast") : t("nowPrivateToast"),
        variant: "success",
      });
    } catch (e) {
      setIsPublic(!next);
      toast({
        title: t("visibilityFailToast"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    }
  }

  const sharedFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="quantity">{t("quantity")}</Label>
        <Input
          id="quantity"
          type="number"
          min={1}
          value={form.quantity}
          onChange={(e) => setField("quantity", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="condition">{t("condition")}</Label>
        <Select
          id="condition"
          value={form.condition}
          onChange={(e) => setField("condition", e.target.value)}
        >
          {Object.keys(CONDITION_LABELS).map((value) => (
            <option key={value} value={value}>
              {tCond(value)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="language">{t("language")}</Label>
        <Select
          id="language"
          value={form.language}
          onChange={(e) => setField("language", e.target.value)}
        >
          {Object.keys(LANGUAGE_LABELS).map((value) => (
            <option key={value} value={value}>
              {tLang(value)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="purchaseDate">{t("purchaseDate")}</Label>
        <Input
          id="purchaseDate"
          type="date"
          value={form.purchaseDate}
          onChange={(e) => setField("purchaseDate", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="purchasePrice">{t("purchasePrice")}</Label>
        <Input
          id="purchasePrice"
          inputMode="decimal"
          placeholder={t("purchasePricePlaceholder")}
          value={form.purchasePrice}
          onChange={(e) => setField("purchasePrice", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="estimatedValue">{t("estimatedValue")}</Label>
        <Input
          id="estimatedValue"
          inputMode="decimal"
          placeholder={t("estimatedValuePlaceholder")}
          value={form.estimatedValue}
          onChange={(e) => setField("estimatedValue", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gradingCompany">{t("gradingCompany")}</Label>
        <Input
          id="gradingCompany"
          placeholder={t("gradingCompanyPlaceholder")}
          value={form.gradingCompany}
          onChange={(e) => setField("gradingCompany", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="grade">{t("grade")}</Label>
        <Input
          id="grade"
          placeholder={t("gradePlaceholder")}
          value={form.grade}
          onChange={(e) => setField("grade", e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea
          id="notes"
          placeholder={t("notesPlaceholder")}
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Verktygsrad */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setSearch("");
            setAddOpen(true);
          }}
        >
          <IconPlus size={16} />
          {t("addManually")}
        </Button>
        {/* CSV-export/import är TILLFÄLLIGT BORTTAGNA ur gränssnittet
            (ägarbeslut 2026-08-11): flödet var glitchigt. API:erna
            (/api/collection/export + /import) är orörda, så knapparna kan
            återställas ur git-historiken när flödet är lagat. */}
        <div className="ml-auto">
          <Checkbox
            id="publicCollection"
            label={t("publicCollection")}
            checked={isPublic}
            onChange={(e) => void togglePublic(e.target.checked)}
          />
        </div>
      </div>

      {/* Tabell */}
      {items.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={32} />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={<Button onClick={() => setAddOpen(true)}>{t("addFirst")}</Button>}
        />
      ) : (
        <>
        {/* Sök + sortering av samlingen (klient-sida, inga URL-parametrar). */}
        <CollectionToolbar
          idPrefix="d-collection"
          query={filterQuery}
          onQueryChange={setFilterQuery}
          sort={sort}
          onSortChange={setSort}
          matchCount={groups.length}
          totalCount={allGroups.length}
          className="max-w-xl"
        />
        {/* Samlingen är inte tom — sökningen träffade bara ingenting. Vägen ut
            är därför att rensa filtret, inte att lägga till ett objekt. */}
        {filterActive && groups.length === 0 ? (
        <EmptyState
          icon={<IconPackage size={32} />}
          title={t("filterNoMatchTitle", { query: filterQuery.trim() })}
          description={t("filterNoMatchDesc")}
          action={
            <Button variant="ghost" onClick={() => setFilterQuery("")}>
              {t("filterClear")}
            </Button>
          }
        />
        ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("colName")}</TH>
              <TH>{t("colSet")}</TH>
              <TH>{t("colQty")}</TH>
              <TH>{t("colCondition")}</TH>
              <TH>{t("colLanguage")}</TH>
              <TH>{t("colPurchasePrice")}</TH>
              <TH>{t("colValueNow")}</TH>
              <TH>{t("colProfit")}</TH>
              <TH>{t("colGrading")}</TH>
              <TH className="text-right">{t("colActions")}</TH>
            </TR>
          </THead>
          <TBody>
            {groups.map((g, index) => {
              const item = g.lots[0];
              const multi = g.lots.length > 1;
              const open = openKeys.has(g.key);
              const lotRowId = (i: number) => `${rowIdBase}-lot-${index}-${i}`;

              // Flera köp av samma vara → en grupprad med totaler + utfällbara köp.
              if (multi) {
                const groupPl = groupProfit(g.lots);
                const unitValue = groupUnitValue(g.lots);
                const partial = g.costedQuantity < g.quantity;
                // Snittet får ALDRIG läsas som att det gäller alla exemplar — täcker det
                // bara en del säger etiketten det rakt ut, och saknas pris helt står "–".
                const avgLabel =
                  g.averagePaid == null
                    ? null
                    : partial
                      ? t("lotAvgPartial", {
                          price: formatPrice(g.averagePaid),
                          costed: g.costedQuantity,
                          total: g.quantity,
                        })
                      : t("lotAvgPaid", { price: formatPrice(g.averagePaid) });
                return (
                  <Fragment key={g.key}>
                    <TR>
                      <TD className="font-medium">
                        <div className="flex items-center gap-3">
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="h-12 w-9 shrink-0 rounded object-contain bg-surface"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface text-ink-faint">
                              <IconPackage size={16} aria-hidden="true" />
                            </span>
                          )}
                          <span>{item.name}</span>
                        </div>
                      </TD>
                      <TD className="text-ink-muted">{item.setName ?? "–"}</TD>
                      <TD className="tabular-nums">{g.quantity}</TD>
                      <TD>{item.condition in CONDITION_LABELS ? tCond(item.condition) : item.condition}</TD>
                      <TD>{item.language in LANGUAGE_LABELS ? tLang(item.language) : item.language}</TD>
                      {/* Snittet, med sitt underlag utskrivet. Ett snitt som tyst gäller
                          1 av 4 exemplar är samma sorts lögn som ett saknat pris läst som 0. */}
                      <TD data-price>
                        {avgLabel == null ? (
                          <span className="text-ink-faint" title={t("lotAvgUnknown")}>
                            –
                          </span>
                        ) : (
                          <span
                            className={partial ? "text-ink-muted" : undefined}
                            title={
                              partial
                                ? t("lotProfitPartialHint", {
                                    costed: g.costedQuantity,
                                    total: g.quantity,
                                  })
                                : undefined
                            }
                          >
                            {avgLabel}
                          </span>
                        )}
                      </TD>
                      <TD data-price className="font-semibold">
                        {formatPrice(unitValue)}
                      </TD>
                      <TD>
                        {groupPl != null ? (
                          <span
                            className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${profitToneClass(
                              groupPl.amount
                            )}`}
                            title={
                              partial
                                ? t("lotProfitPartialHint", {
                                    costed: g.costedQuantity,
                                    total: g.quantity,
                                  })
                                : t("profitRowHint", { count: g.quantity })
                            }
                          >
                            {groupPl.amount > 0 && <IconTrendingUp size={14} aria-hidden="true" />}
                            {groupPl.amount < 0 && <IconTrendingDown size={14} aria-hidden="true" />}
                            <span data-price>
                              {groupPl.amount > 0 ? "+" : ""}
                              {formatPrice(groupPl.amount)}
                            </span>
                            {groupPl.percent != null && (
                              <span className="text-xs opacity-80">({formatPercent(groupPl.percent)})</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-faint" title={t("profitNoBasisHint")}>
                            –
                          </span>
                        )}
                      </TD>
                      <TD>
                        {item.gradingCompany && item.grade ? (
                          <Badge variant="holo">
                            {item.gradingCompany} {item.grade}
                          </Badge>
                        ) : (
                          "–"
                        )}
                      </TD>
                      {/* Gruppen är en VISNING — redigera/sälj/radera hör till en enskild
                          post och bor därför i underraderna. Här finns bara utfällaren. */}
                      <TD>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open}
                            aria-controls={g.lots.map((_, i) => lotRowId(i)).join(" ")}
                            onClick={() => toggleGroup(g.key)}
                          >
                            {t("lotCount", { count: g.lots.length })}
                            <IconChevronDown
                              size={16}
                              className={`transition-transform ${open ? "rotate-180" : ""}`}
                            />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                    {/* Underraderna ligger kvar i DOM:en även hopfällda — annars pekar
                        utfällarens aria-controls på id:n som inte finns. */}
                    {g.lots.map((lot, i) => {
                        const lotPl = rowProfit(lot);
                        return (
                          <TR key={lot.id} id={lotRowId(i)} className={open ? "text-sm" : "hidden"}>
                            {/* Underraden identifieras av sitt KÖPDATUM — det är det enda
                                som skiljer två köp av samma vara åt för ögat. */}
                            <TD className="pl-16 text-ink-muted">{formatDate(lot.purchaseDate)}</TD>
                            <TD />
                            <TD className="tabular-nums text-ink-muted">{lot.quantity}</TD>
                            <TD />
                            <TD />
                            {/* formatPrice ger "–" för null: ett saknat pris är inte 0 kr. */}
                            <TD data-price>{formatPrice(lot.purchasePrice)}</TD>
                            <TD data-price>{formatPrice(lot.estimatedValue)}</TD>
                            <TD>
                              {lotPl != null ? (
                                <span
                                  className={`inline-flex items-center gap-1 text-sm tabular-nums ${profitToneClass(
                                    lotPl.amount
                                  )}`}
                                >
                                  <span data-price>
                                    {lotPl.amount > 0 ? "+" : ""}
                                    {formatPrice(lotPl.amount)}
                                  </span>
                                  {lotPl.percent != null && (
                                    <span className="text-xs opacity-80">
                                      ({formatPercent(lotPl.percent)})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-ink-faint" title={t("profitNoBasisHint")}>
                                  –
                                </span>
                              )}
                            </TD>
                            <TD />
                            <TD>
                              <div className="flex justify-end gap-2">
                                <SellButton row={lot} />
                                <Button size="sm" variant="ghost" onClick={() => openEdit(lot)}>
                                  {tc("edit")}
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setDeleting(lot)}>
                                  {tc("delete")}
                                </Button>
                              </div>
                            </TD>
                          </TR>
                        );
                      })}
                  </Fragment>
                );
              }

              const profit = rowProfit(item);
              return (
                <TR key={item.id}>
                  <TD className="font-medium">
                    <div className="flex items-center gap-3">
                      {/* Svart bildbrunn, samma behandling som Utforska-kortet
                          (product-card.tsx). `surface-overlay` är en interaktiv fyllning,
                          inte en bakgrund — som brunn blev varje rad grå. */}
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="h-12 w-9 shrink-0 rounded object-contain bg-surface"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface text-ink-faint">
                          <IconPackage size={16} aria-hidden="true" />
                        </span>
                      )}
                      <span>{item.name}</span>
                    </div>
                  </TD>
                  <TD className="text-ink-muted">{item.setName ?? "–"}</TD>
                  <TD className="tabular-nums">{item.quantity}</TD>
                  <TD>{item.condition in CONDITION_LABELS ? tCond(item.condition) : item.condition}</TD>
                  <TD>{item.language in LANGUAGE_LABELS ? tLang(item.language) : item.language}</TD>
                  <TD data-price>{formatPrice(item.purchasePrice)}</TD>
                  <TD data-price className="font-semibold">
                    {formatPrice(item.estimatedValue)}
                  </TD>
                  {/* Vinst/förlust: BELOPP först (det man faktiskt tjänat/förlorat på
                      posten, alla ex. inräknade) och procenten som stöd. Utan köppris
                      finns ingen kostnadsbas — då står "–" och posten räknas heller inte
                      in i portföljtotalen ovan. */}
                  <TD>
                    {profit != null ? (
                      <span
                        className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${profitToneClass(
                          profit.amount
                        )}`}
                        title={item.quantity > 1 ? t("profitRowHint", { count: item.quantity }) : undefined}
                      >
                        {profit.amount > 0 && <IconTrendingUp size={14} aria-hidden="true" />}
                        {profit.amount < 0 && <IconTrendingDown size={14} aria-hidden="true" />}
                        <span data-price>
                          {profit.amount > 0 ? "+" : ""}
                          {formatPrice(profit.amount)}
                        </span>
                        {profit.percent != null && (
                          <span className="text-xs opacity-80">({formatPercent(profit.percent)})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-ink-faint" title={t("profitNoBasisHint")}>
                        –
                      </span>
                    )}
                  </TD>
                  <TD>
                    {item.gradingCompany && item.grade ? (
                      <Badge variant="holo">
                        {item.gradingCompany} {item.grade}
                      </Badge>
                    ) : (
                      "–"
                    )}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-2">
                      <SellButton row={item} />
                      <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                        {tc("edit")}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(item)}>
                        {tc("delete")}
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        )}
        </>
      )}

      {/* Lägg till */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("addTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitAdd()} loading={saving}>
              {t("add")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cardSearch">{t("searchCard")}</Label>
            <div className="relative">
              <Input
                id="cardSearch"
                placeholder={t("searchCardPlaceholder")}
                value={form.cardId ? form.cardLabel : search}
                onChange={(e) => {
                  setField("cardId", "");
                  setField("cardLabel", "");
                  setSearch(e.target.value);
                }}
              />
              {searching && (
                <span className="absolute right-3 top-2.5">
                  <Spinner size="sm" />
                </span>
              )}
            </div>
            {!form.cardId && hits.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-surface-border bg-surface-overlay">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      // Listan ÄR surface-overlay → hovern måste vara ljusare (se dropdown.tsx).
                      className="w-full px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-border/50"
                      onClick={() => {
                        const label = `${hit.name} · ${hit.set?.name ?? t("unknownSet")} #${hit.number}`;
                        setForm((prev) => ({ ...prev, cardId: hit.id, cardLabel: label, freeText: "" }));
                        setHits([]);
                      }}
                    >
                      {hit.name}{" "}
                      <span className="text-ink-muted">
                        · {hit.set?.name ?? t("unknownSet")} #{hit.number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!form.cardId && (
            <div>
              <Label htmlFor="freeText">{t("orFreeText")}</Label>
              <Input
                id="freeText"
                placeholder={t("freeTextPlaceholder")}
                value={form.freeText}
                onChange={(e) => setField("freeText", e.target.value)}
              />
            </div>
          )}

          {sharedFields}
          <FieldError message={formError} />
        </div>
      </Modal>

      {/* Redigera */}
      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title={t("editTitle", { name: editing?.name ?? "" })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitEdit()} loading={saving}>
              {tc("save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {sharedFields}
          <FieldError message={formError} />
        </div>
      </Modal>

      {/* Ta bort */}
      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t("deleteTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {tc("cancel")}
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={saving}>
              {tc("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          {t.rich("deleteConfirm", {
            name: deleting?.name ?? "",
            b: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
          })}
        </p>
      </Modal>
    </div>
  );
}
