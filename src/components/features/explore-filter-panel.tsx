"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useExploreParams } from "@/components/features/explore-params";
import { IconCheck, IconFilter, IconX } from "@/components/ui/icons";

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
  count: number;
}

interface PanelProps {
  categories: FacetOption[];
  sets: FilterSetOption[];
  retailers: FacetOption[];
  languages: FacetOption[];
  /** Antal produkter per prisintervall — kanterna i edgesKr, sista = öppet uppåt. */
  priceBuckets: number[];
  edgesKr: readonly number[];
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
  onToggle,
}: {
  checked: boolean;
  label: string;
  count?: number;
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

/* ─────────────────────────── prisreglaget ─────────────────────────── */

/**
 * Reglagets lägen ÄR histogramkanterna (index i edgesKr, sista läget = inget tak)
 * — staplar och tumlägen kan då aldrig peka på olika intervall. Två native
 * <input type="range"> ovanpå varandra (tummarna får pointer-events, spåren
 * inte — CSS i globals: .dual-range). Navigeringen sker först när tummen
 * SLÄPPS, annars hade varje pixeldrag varit en server-rendering.
 */
function PriceSlider({
  edgesKr,
  buckets,
  minIdx,
  maxIdx,
  onDraft,
  onCommit,
}: {
  edgesKr: readonly number[];
  buckets: number[];
  minIdx: number;
  maxIdx: number;
  onDraft: (minIdx: number, maxIdx: number) => void;
  onCommit: () => void;
}) {
  const t = useTranslations("Products");
  const N = edgesKr.length;
  const maxCount = Math.max(1, ...buckets);
  const minPct = (minIdx / N) * 100;
  const maxPct = (maxIdx / N) * 100;

  return (
    <div>
      <div aria-hidden className="flex h-12 items-end gap-px">
        {buckets.map((count, i) => {
          const inRange = i >= minIdx && i < maxIdx;
          // sqrt-skala: singlarna dominerar lågprisintervallen så grovt att en
          // linjär skala hade gjort alla andra staplar osynliga.
          const height = count > 0 ? Math.max(10, Math.sqrt(count / maxCount) * 100) : 4;
          return (
            <span
              key={i}
              style={{ height: `${height}%` }}
              className={cn(
                "min-w-0 flex-1 rounded-[2px] transition-colors",
                inRange ? "bg-holo-cyan/70" : "bg-surface-overlay"
              )}
            />
          );
        })}
      </div>

      <div className="dual-range relative mt-1.5 h-6">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-overlay" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-holo-cyan"
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={N}
          step={1}
          value={minIdx}
          aria-label={t("minThumbAria")}
          aria-valuetext={`${nf.format(edgesKr[minIdx])} kr`}
          onChange={(e) => onDraft(Math.min(Number(e.target.value), maxIdx - 1), maxIdx)}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
        <input
          type="range"
          min={0}
          max={N}
          step={1}
          value={maxIdx}
          aria-label={t("maxThumbAria")}
          aria-valuetext={maxIdx >= N ? t("priceNoCap", { min: nf.format(edgesKr[N - 1]) }) : `${nf.format(edgesKr[maxIdx])} kr`}
          onChange={(e) => onDraft(minIdx, Math.max(Number(e.target.value), minIdx + 1))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
      </div>
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
  priceBuckets,
  edgesKr,
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
  const [showAllSets, setShowAllSets] = useState(false);
  const [showAllStores, setShowAllStores] = useState(false);

  /* Prisreglaget: lokalt utkast medan tummen dras, URL:en först vid släpp. */
  const N = edgesKr.length;
  const nearestIdx = (kr: number) =>
    edgesKr.reduce((best, edge, i) => (Math.abs(edge - kr) < Math.abs(edgesKr[best] - kr) ? i : best), 0);
  const urlMinIdx = minPris && Number(minPris) > 0 ? nearestIdx(Number(minPris)) : 0;
  const urlMaxIdx =
    maxPris && Number(maxPris) > 0 ? Math.max(nearestIdx(Number(maxPris)), urlMinIdx + 1) : N;
  const [draft, setDraft] = useState<{ min: number; max: number }>({ min: urlMinIdx, max: urlMaxIdx });
  const priceKey = `${minPris}|${maxPris}`;
  useEffect(() => {
    // Extern navigering (chips, presets, bakåtknapp) → reglaget följer URL:en.
    setDraft({ min: urlMinIdx, max: urlMaxIdx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  const commitPrice = () => {
    if (draft.min === urlMinIdx && draft.max === urlMaxIdx) return;
    apply({
      minPris: draft.min === 0 ? null : String(edgesKr[draft.min]),
      maxPris: draft.max >= N ? null : String(edgesKr[draft.max]),
    });
  };

  const pricePresets: { min: number | null; max: number | null }[] = [
    { min: null, max: null },
    { min: null, max: 200 },
    { min: 200, max: 500 },
    { min: 500, max: 1000 },
    { min: 1000, max: null },
  ];
  const currentMin = minPris ? Number(minPris) : null;
  const currentMax = maxPris ? Number(maxPris) : null;
  const presetLabel = (p: { min: number | null; max: number | null }) => {
    if (p.min === null && p.max === null) return t("all");
    // Utan "kr"-suffix — kolumnen heter redan "Pris (kr)" och chipsen ska läsa
    // som en skala ("0–200 · 200–500 · 1 000+"), inte som fem meningar.
    if (p.max === null) return `${nf.format(p.min ?? 0)}+`;
    return `${nf.format(p.min ?? 0)}–${nf.format(p.max)}`;
  };
  const presetActive = (p: { min: number | null; max: number | null }) =>
    (currentMin ?? null) === p.min && (currentMax ?? null) === p.max;

  // Förformaterade tal (tusentalsmellanslag) — next-intl formaterar inte bara
  // interpolerade tal av sig själv, och "1000" bredvid "1 000" ser trasigt ut.
  const priceSummary =
    currentMin === null && currentMax === null
      ? t("anyPrice")
      : currentMax === null
        ? t("priceNoCap", { min: nf.format(currentMin ?? 0) })
        : t("priceSpan", { min: nf.format(currentMin ?? 0), max: nf.format(currentMax) });

  /* Listor: topp-N efter antal, men en ikryssad rad utanför toppen visas alltid
     — annars går ett aktivt filter inte att kryssa UR utan att fälla ut listan. */
  const visibleRows = <T,>(all: T[], expanded: boolean, isChecked: (item: T) => boolean) => {
    if (expanded) return all;
    const top = all.slice(0, COLLAPSED_ROWS);
    const pinned = all.filter((item) => isChecked(item) && !top.includes(item));
    return [...top, ...pinned];
  };

  const enSets = useMemo(() => sets.filter((s) => s.language !== "JP"), [sets]);
  const jpSets = useMemo(() => sets.filter((s) => s.language === "JP"), [sets]);
  const setsByCount = useMemo(() => [...enSets].sort((a, b) => b.count - a.count), [enSets]);

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
      onToggle={() => apply({ set: activeSet === s.id ? null : s.id })}
    />
  );

  return (
    <div className="card-surface flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-y-auto">
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

        <Section
          title={t("price")}
          action={<span className="text-xs font-medium text-holo-cyan">{priceSummary}</span>}
        >
          <PriceSlider
            edgesKr={edgesKr}
            buckets={priceBuckets}
            minIdx={draft.min}
            maxIdx={draft.max}
            onDraft={(min, max) => setDraft({ min, max })}
            onCommit={commitPrice}
          />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pricePresets.map((p, i) => {
              const active = presetActive(p);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    apply({
                      minPris: p.min !== null ? String(p.min) : null,
                      maxPris: p.max !== null ? String(p.max) : null,
                    })
                  }
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
                    active
                      ? "border-holo-cyan/60 bg-holo-cyan/10 text-holo-cyan"
                      : "border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-ink"
                  )}
                >
                  {presetLabel(p)}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={t("set")}>
          <div className={cn(showAllSets && "max-h-72 overflow-y-auto pr-1")}>
            {visibleRows(setsByCount, showAllSets, (s) => activeSet === s.id).map(setRow)}
            {showAllSets && jpSets.length > 0 && (
              <>
                <p className="mb-1 mt-3 px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  {t("setLanguageJp")}
                </p>
                {jpSets.map(setRow)}
              </>
            )}
          </div>
          {(enSets.length > COLLAPSED_ROWS || jpSets.length > 0) && (
            <ExpandToggle
              expanded={showAllSets}
              label={showAllSets ? t("showFewer") : t("browseAllSets", { count: sets.length })}
              onClick={() => setShowAllSets((v) => !v)}
            />
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
      </div>

      <div className="border-t border-surface-border/60 bg-surface/95 p-3">
        <Button type="button" className="w-full" onClick={scrollToResults}>
          {t("showResults", { results: t("resultCount", { count: total }) })}
        </Button>
      </div>
    </div>
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
