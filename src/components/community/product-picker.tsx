"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { IconCards, IconX } from "@/components/ui/icons";

export interface PickedProduct {
  slug: string;
  title: string;
  imageUrl: string | null;
  setName: string | null;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

/**
 * Katalogväljaren i komponisten. Söker via /api/search/suggest (serverns
 * 24h-index i minnet — ingen Neon-fråga per tangenttryck) och lämnar tillbaka
 * produktens SLUG; API:t slår upp id:t vid publiceringen.
 */
export function ProductPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedProduct | null;
  onChange: (next: PickedProduct | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Forum");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedProduct[] | null>(null);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: PickedProduct[] };
        setResults(data.items);
      } catch {
        // avbruten/nätverksfel — behåll det som visas
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-holo-cyan/40 bg-holo-cyan/[0.06] p-2.5">
        {value.imageUrl ? (
          <img
            src={value.imageUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-md bg-surface-overlay object-contain p-0.5"
          />
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-overlay text-ink-faint">
            <IconCards size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{value.title}</span>
          {value.setName && (
            <span className="block truncate text-xs text-ink-muted">{value.setName}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t("composerProductRemove")}
          disabled={disabled}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-overlay hover:text-ink"
        >
          <IconX size={16} />
        </button>
      </div>
    );
  }

  const open = focused && q.length >= MIN_QUERY && results !== null;

  return (
    <div ref={containerRef} className="relative">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder={t("composerProductSearch")}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-surface-border bg-surface-raised shadow-2xl shadow-black/40"
        >
          {results.map((s) => (
            <li key={s.slug} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange(s);
                  setQuery("");
                  setResults(null);
                  setFocused(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-overlay"
                )}
              >
                {s.imageUrl ? (
                  <img
                    src={s.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 shrink-0 rounded-md bg-surface-overlay object-contain p-0.5"
                  />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-overlay text-ink-faint">
                    <IconCards size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{s.title}</span>
                  {s.setName && (
                    <span className="block truncate text-xs text-ink-muted">{s.setName}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">{t("composerProductNone")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
