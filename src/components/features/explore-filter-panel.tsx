"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { isSealedCategory } from "@/lib/product-category";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/ui/safe-image";
import { SetSheet } from "@/components/features/explore-filter-bar";
import { useExploreParams } from "@/components/features/explore-params";
import { IconCards, IconCheck, IconFilter, IconX } from "@/components/ui/icons";

/** Antal rader per lista innan "Visa alla …"-utfällningen tar vid. */
const COLLAPSED_ROWS = 5;

const nf = new Intl.NumberFormat("sv-SE");

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterSetOption {
  id: string;
  name: string;
  language: string;
  logoUrl: string | null;
  series: string;
  count: number;
}

interface PanelProps {
  categories: FacetOption[];
  sets: FilterSetOption[];
  retailers: FacetOption[];
  languages: FacetOption[];
  /** Aktuellt träffantal (SSR) — filtren applicerar direkt, så talet är i synk. */
  total: number;
}

/* ─────────────────────────── byggstenar ─────────────────────────── */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-surface-border/60 px-4 py-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function FacetRow({
  checked,
  label,
  count,
  thumb,
  onToggle,
}: {
  checked: boolean;
  label: string;
  count?: number;
  /** Liten bild mellan kryssrutan och etiketten (setlogotyp). */
  thumb?: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-overlay/50 focus-visible:bg-surface-overlay/50 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
          checked ? "border-holo-cyan bg-holo-cyan text-surface" : "border-surface-border"
        )}
      >
        {checked && <IconCheck size={11} strokeWidth={3} />}
      </span>
      {thumb}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          checked ? "font-medium text-holo-cyan" : "text-ink"
        )}
      >
        {label}
      </span>
      {count != null && (
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{nf.format(count)}</span>
      )}
    </button>
  );
}

function ExpandToggle({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className="mt-1 px-1.5 text-sm text-holo-cyan transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
    >
      {label}
    </button>
  );
}

function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid gap-0.5 rounded-lg bg-surface-overlay p-0.5",
        options.length === 3 ? "grid-cols-3" : "grid-cols-2"
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
              active ? "bg-ink text-surface" : "text-ink-muted hover:text-ink"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── panelen ─────────────────────────── */

/**
 * Desktop-katalogens filtersidofält. Varje kontroll navigerar DIREKT (samma
 * URL-parametrar som GET-formuläret på mobilen) — "Visa N produkter"-knappen
 * längst ner är en bekräftelse som scrollar till resultatet, inte en submit.
 * Facetantalen är globala och 1h-cachade (se services/explore-facets).
 */
export function ExploreFilterPanel({
  categories,
  sets,
  retailers,
  languages,
  total,
}: PanelProps) {
  const t = useTranslations("Products");
  const { sp, apply, toggleCsv, getCsv } = useExploreParams();

  const activeCategories = getCsv("kategori");
  const activeStores = getCsv("butik");
  const activeSet = sp?.get("set") ?? "";
  const activeLanguage = sp?.get("sprak") ?? "";
  const inStockOnly = sp?.get("lager") === "1";
  const minPris = sp?.get("minPris") ?? "";
  const maxPris = sp?.get("maxPris") ?? "";

  const [showAllCategories, setShowAllCategories] = useState(false);
  // "Bläddra bland alla set" öppnar SAMMA logotyp-ark som mobilen (SetSheet) —
  // ingen inline-utfällning för set på desktop (ägarbeslut 2026-08-11).
  const [setSheetOpen, setSetSheetOpen] = useState(false);
  const [showAllStores, setShowAllStores] = useState(false);

  /* Prisintervallet: lokala fältvärden, URL:en först vid Enter/blur
     (ägarbeslut 2026-08-11: rena Från–Till-fält i stället för
     histogram + reglage + snabbval — kompaktare). */
  const [minInput, setMinInput] = useState(minPris);
  const [maxInput, setMaxInput] = useState(maxPris);
  const priceKey = `${minPris}|${maxPris}`;
  useEffect(() => {
    // Extern navigering (chips, bakåtknapp) → fälten följer URL:en.
    setMinInput(minPris);
    setMaxInput(maxPris);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  const commitPrice = () => {
    const norm = (raw: string): string | null => {
      const n = Number(raw.trim().replace(",", "."));
      return Number.isFinite(n) && n > 0 ? String(n) : null;
    };
    let lo = norm(minInput);
    let hi = norm(maxInput);
    // Omvänt intervall är aldrig avsikten — byt plats i stället för noll träffar.
    if (lo !== null && hi !== null && Number(lo) > Number(hi)) [lo, hi] = [hi, lo];
    if ((lo ?? "") === minPris && (hi ?? "") === maxPris) return;
    apply({ minPris: lo, maxPris: hi });
  };

  const currentMin = minPris ? Number(minPris) : null;
  const currentMax = maxPris ? Number(maxPris) : null;

  /* Listor: topp-N efter antal, men en ikryssad rad utanför toppen visas alltid
     — annars går ett aktivt filter inte att kryssa UR utan att fälla ut listan. */
  const visibleRows = <T,>(all: T[], expanded: boolean, isChecked: (item: T) => boolean) => {
    if (expanded) return all;
    const top = all.slice(0, COLLAPSED_ROWS);
    const pinned = all.filter((item) => isChecked(item) && !top.includes(item));
    return [...top, ...pinned];
  };

  const setsByCount = useMemo(() => [...sets].sort((a, b) => b.count - a.count), [sets]);

  /**
   * "Alla sealed" — en genväg, inte en kategori (samma regel som mobilens
   * kategorisheet): kryssad exakt när urvalet ÄR hela sealed-mängden.
   */
  const sealedValues = categories.map((c) => c.value).filter(isSealedCategory);
  const sealedActive =
    sealedValues.length > 0 &&
    activeCategories.length === sealedValues.length &&
    sealedValues.every((v) => activeCategories.includes(v));
  const sealedCount = categories
    .filter((c) => isSealedCategory(c.value))
    .reduce((sum, c) => sum + (c.count ?? 0), 0);

  const activeCount =
    activeCategories.length +
    activeStores.length +
    (activeSet ? 1 : 0) +
    (activeLanguage ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    (currentMin !== null || currentMax !== null ? 1 : 0);

  const clearAll = () =>
    apply({
      kategori: null,
      set: null,
      butik: null,
      minPris: null,
      maxPris: null,
      lager: null,
      sprak: null,
    });

  const scrollToResults = () => {
    const target = document.getElementById("explore-results");
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const setRow = (s: FilterSetOption) => (
    <FacetRow
      key={s.id}
      checked={activeSet === s.id}
      label={s.name}
      count={s.count > 0 ? s.count : undefined}
      thumb={
        <span aria-hidden className="grid h-6 w-10 shrink-0 place-items-center">
          <SafeImage
            src={s.logoUrl}
            alt=""
            className="max-h-6 max-w-full object-contain"
            fallback={<IconCards size={14} className="text-ink-faint" />}
          />
        </span>
      }
      onToggle={() => apply({ set: activeSet === s.id ? null : s.id })}
    />
  );

  return (
    <>
      {/* Panelen är hela sin egen höjd och scrollar med SIDAN — ingen egen
          rullningslist (ägarbeslut 2026-08-11). Bara butikslistans utfällning
          behåller en intern scroll. */}
      <div className="card-surface overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-surface-border/60 px-4 py-3.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <IconFilter size={16} className="text-holo-cyan" aria-hidden />
            {t("filters")}
            {activeCount > 0 && (
              <span className="rounded-full bg-holo-cyan/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-holo-cyan">
                {activeCount}
              </span>
            )}
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
            >
              {t("clearAll")}
            </button>
          )}
        </div>

        <Section title={t("availability")}>
          <Segmented
            label={t("availability")}
            value={inStockOnly ? "1" : ""}
            onChange={(v) => apply({ lager: v || null })}
            options={[
              { value: "", label: t("all") },
              { value: "1", label: t("inStockShort") },
            ]}
          />
        </Section>

        <Section title={t("category")}>
          <div>
            {sealedValues.length > 0 && (
              <FacetRow
                checked={sealedActive}
                label={t("allSealed")}
                count={sealedCount}
                onToggle={() =>
                  apply({ kategori: sealedActive ? null : sealedValues.join(",") })
                }
              />
            )}
            {visibleRows(categories, showAllCategories, (c) => activeCategories.includes(c.value)).map(
              (c) => (
                <FacetRow
                  key={c.value}
                  checked={activeCategories.includes(c.value)}
                  label={c.label}
                  count={c.count}
                  onToggle={() => toggleCsv("kategori", c.value)}
                />
              )
            )}
          </div>
          {categories.length > COLLAPSED_ROWS && (
            <ExpandToggle
              expanded={showAllCategories}
              label={
                showAllCategories
                  ? t("showFewer")
                  : t("showAllCategories", { count: categories.length })
              }
              onClick={() => setShowAllCategories((v) => !v)}
            />
          )}
        </Section>

        <Section title={t("price")}>
          {/* Samma fältform som mobilens prisark: etikett i rutan, tomt fält =
              ingen gräns. Navigerar på Enter/blur, bara när värdet ändrats. */}
          <div className="flex items-center gap-2">
            {(
              [
                { key: "min", label: t("priceFrom"), aria: t("minAria"), value: minInput, set: setMinInput, placeholder: "0" },
                { key: "max", label: t("priceTo"), aria: t("maxAria"), value: maxInput, set: setMaxInput, placeholder: t("max") },
              ] as const
            ).map((field, i) => (
              <span key={field.key} className="contents">
                {i > 0 && <span aria-hidden className="text-ink-faint">–</span>}
                <label className="min-w-0 flex-1 rounded-lg border border-surface-border px-2.5 py-1.5 transition-colors focus-within:border-holo-cyan/60">
                  <span className="block text-[9px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                    {field.label}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={field.placeholder}
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                    onBlur={commitPrice}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={field.aria}
                    // Spinnerpilarna göms — fälten ska läsa som ett rent
                    // intervall, och 1 kr-steg är ändå meningslösa här.
                    className="w-full bg-transparent text-sm tabular-nums text-ink [appearance:textfield] placeholder:text-ink-faint focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </label>
              </span>
            ))}
          </div>
        </Section>

        <Section title={t("set")}>
          <div>{visibleRows(setsByCount, false, (s) => activeSet === s.id).map(setRow)}</div>
          {sets.length > COLLAPSED_ROWS && (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setSetSheetOpen(true)}
              className="mt-1 px-1.5 text-sm text-holo-cyan transition-colors hover:text-ink focus-visible:outline-none focus-visible:underline"
            >
              {t("browseAllSets", { count: sets.length })}
            </button>
          )}
        </Section>

        <Section title={t("store")}>
          <div className={cn(showAllStores && "max-h-72 overflow-y-auto pr-1")}>
            {visibleRows(retailers, showAllStores, (r) => activeStores.includes(r.value)).map((r) => (
              <FacetRow
                key={r.value}
                checked={activeStores.includes(r.value)}
                label={r.label}
                count={r.count}
                onToggle={() => toggleCsv("butik", r.value)}
              />
            ))}
          </div>
          {retailers.length > COLLAPSED_ROWS && (
            <ExpandToggle
              expanded={showAllStores}
              label={showAllStores ? t("showFewer") : t("browseAllStores", { count: retailers.length })}
              onClick={() => setShowAllStores((v) => !v)}
            />
          )}
        </Section>

        <Section title={t("language")}>
          <Segmented
            label={t("language")}
            value={activeLanguage}
            onChange={(v) => apply({ sprak: v || null })}
            options={[{ value: "", label: t("all") }, ...languages.map((l) => ({ value: l.value, label: l.label }))]}
          />
        </Section>

        <div className="p-3">
          <Button type="button" className="w-full" onClick={scrollToResults}>
            {t("showResults", { results: t("resultCount", { count: total }) })}
          </Button>
        </div>
      </div>

      {/* Samma logotyp-ark som mobilen (portalas till <body>): val applicerar
          direkt och stänger arket. */}
      <SetSheet
        open={setSheetOpen}
        sets={sets}
        activeSetId={activeSet || undefined}
        total={total}
        onClose={() => setSetSheetOpen(false)}
        onPick={(id) => {
          setSetSheetOpen(false);
          apply({ set: id ?? null });
        }}
      />
    </>
  );
}

/* ─────────────────────────── aktiva filter-chips ─────────────────────────── */

/**
 * Chipsraden ovanför resultatet: träffantal + ett avfärgbart chip per aktivt
 * filter. Kryss = ta bort precis det filtret (utan att röra de andra).
 */
export function ExploreActiveChips({
  categories,
  sets,
  retailers,
  languages,
  total,
}: {
  categories: FacetOption[];
  sets: { id: string; name: string }[];
  retailers: FacetOption[];
  languages: FacetOption[];
  total: number;
}) {
  const t = useTranslations("Products");
  const { sp, apply, toggleCsv, getCsv } = useExploreParams();

  const categoryLabel = new Map(categories.map((c) => [c.value, c.label]));
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  const retailerLabel = new Map(retailers.map((r) => [r.value, r.label]));
  const languageLabel = new Map(languages.map((l) => [l.value, l.label]));

  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  const q = sp?.get("q");
  if (q) chips.push({ key: "q", label: `”${q}”`, onRemove: () => apply({ q: null }) });

  for (const value of getCsv("kategori")) {
    chips.push({
      key: `kategori-${value}`,
      label: categoryLabel.get(value) ?? value,
      onRemove: () => toggleCsv("kategori", value),
    });
  }

  const set = sp?.get("set");
  if (set) {
    chips.push({
      key: "set",
      label: setName.get(set) ?? t("set"),
      onRemove: () => apply({ set: null }),
    });
  }

  for (const value of getCsv("butik")) {
    chips.push({
      key: `butik-${value}`,
      label: retailerLabel.get(value) ?? value,
      onRemove: () => toggleCsv("butik", value),
    });
  }

  const minPris = sp?.get("minPris");
  const maxPris = sp?.get("maxPris");
  if (minPris || maxPris) {
    const label = !maxPris
      ? t("priceNoCap", { min: nf.format(Number(minPris) || 0) })
      : t("priceSpan", { min: nf.format(Number(minPris) || 0), max: nf.format(Number(maxPris)) });
    chips.push({ key: "pris", label, onRemove: () => apply({ minPris: null, maxPris: null }) });
  }

  if (sp?.get("lager") === "1") {
    chips.push({ key: "lager", label: t("inStockShort"), onRemove: () => apply({ lager: null }) });
  }

  const language = sp?.get("sprak");
  if (language) {
    chips.push({
      key: "sprak",
      label: languageLabel.get(language.split(",")[0] ?? "") ?? language,
      onRemove: () => apply({ sprak: null }),
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" aria-live="polite">
      <p className="mr-1 text-sm font-semibold text-ink">{t("resultCount", { count: total })}</p>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          aria-label={t("removeFilter", { name: chip.label })}
          className="inline-flex items-center gap-1.5 rounded-full border border-holo-cyan/40 bg-holo-cyan/10 py-1 pl-3 pr-2 text-xs font-medium text-holo-cyan transition-colors hover:border-holo-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan"
        >
          {chip.label}
          <IconX size={12} aria-hidden />
        </button>
      ))}
    </div>
  );
}
