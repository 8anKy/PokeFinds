"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SearchAutocomplete } from "@/components/features/search-autocomplete";
import { useExploreParams } from "@/components/features/explore-params";
import { IconCheck, IconChevronDown, IconSearch } from "@/components/ui/icons";

export interface SortOption {
  value: string;
  label: string;
}

/**
 * Desktop-katalogens sökrad: ett fullbrett sökfält över hela innehållsbredden
 * (sidofält + rutnät) och sorteringsmenyn som egen kontroll till höger.
 * Ingen skanna-genväg här — kortskanning kräver en kamera, och desktop är
 * precis den miljö som inte har någon riktad mot ett kort.
 */
export function ExploreSearchRow({
  defaultQuery,
  hiddenParams,
  sortOptions,
  currentSort,
  defaultSort,
}: {
  defaultQuery?: string;
  /** Aktiva filter som speglas som dolda fält så Enter-sökningen behåller dem. */
  hiddenParams: Record<string, string | undefined>;
  sortOptions: SortOption[];
  currentSort: string;
  defaultSort: string;
}) {
  const t = useTranslations("Products");
  const formRef = useRef<HTMLFormElement>(null);

  // ⌘K/Ctrl+K fokuserar sökfältet. Etiketten sätts efter mount (plattformen är
  // okänd på servern — att gissa hade gett en hydreringsvarning).
  const [shortcutLabel, setShortcutLabel] = useState<string | null>(null);
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    setShortcutLabel(isMac ? "⌘K" : "Ctrl K");
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        formRef.current
          ?.querySelector<HTMLInputElement>('input:not([type="hidden"])')
          ?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative z-30 flex items-stretch gap-3">
      <form ref={formRef} method="GET" action="/produkter" className="min-w-0 flex-1">
        {Object.entries(hiddenParams).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} readOnly /> : null
        )}
        <SearchAutocomplete
          id="d-q"
          defaultValue={defaultQuery ?? ""}
          placeholder={t("searchPlaceholder")}
          ariaLabel={t("search")}
          className="flex h-12 items-center gap-3 rounded-xl border border-surface-border bg-surface-raised px-4 transition-colors focus-within:border-holo-cyan focus-within:ring-2 focus-within:ring-holo-cyan/30"
          leading={<IconSearch size={18} className="shrink-0 text-holo-cyan" aria-hidden />}
          trailing={
            shortcutLabel && (
              <kbd
                aria-hidden
                className="hidden shrink-0 rounded-md border border-surface-border bg-surface-overlay px-1.5 py-0.5 font-sans text-[11px] text-ink-faint xl:block"
              >
                {shortcutLabel}
              </kbd>
            )
          }
        />
      </form>
      <ExploreSortMenu options={sortOptions} current={currentSort} defaultValue={defaultSort} />
    </div>
  );
}

/** Sorteringsmenyn: egen kontroll bredvid sökfältet (mockupens "SORT"-låda). */
function ExploreSortMenu({
  options,
  current,
  defaultValue,
}: {
  options: SortOption[];
  current: string;
  defaultValue: string;
}) {
  const t = useTranslations("Products");
  const { apply } = useExploreParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = options.find((o) => o.value === current) ?? options[0];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 items-center gap-3 rounded-xl border border-surface-border bg-surface-raised px-4 text-left transition-colors hover:border-holo-cyan/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan"
      >
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {t("sortLabel")}
          </span>
          <span className="block text-sm font-semibold leading-tight text-ink">
            {active?.label}
          </span>
        </span>
        <IconChevronDown
          size={16}
          className={cn("text-ink-muted transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("sortLabel")}
          className="absolute right-0 z-40 mt-2 w-60 animate-fade-in rounded-xl border border-surface-border bg-surface-overlay p-1.5 shadow-card"
        >
          {options.map((o) => {
            const selected = o.value === active?.value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false);
                  apply({ sortera: o.value === defaultValue ? null : o.value });
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-border/50 focus-visible:bg-surface-border/50 focus-visible:outline-none",
                  selected ? "font-medium text-holo-cyan" : "text-ink"
                )}
              >
                {o.label}
                {selected && <IconCheck size={16} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
