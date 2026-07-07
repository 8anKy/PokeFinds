"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { IconCards } from "@/components/ui/icons";

/** Vad /api/search/suggest returnerar per produkt. */
interface Suggestion {
  title: string;
  slug: string;
  imageUrl: string | null;
  setName: string | null;
  category: string;
}

const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
const CLIENT_CACHE_MAX = 50;

export interface SearchAutocompleteProps {
  /** Fältnamn i GET-formuläret (default "q"). */
  name?: string;
  id?: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Styling för den yttre "fält"-behållaren (border, bakgrund, focus-within…). */
  className?: string;
  inputClassName?: string;
  /** T.ex. sök-ikon till vänster om fältet. */
  leading?: ReactNode;
  /** T.ex. filter-knapp till höger om fältet. */
  trailing?: ReactNode;
  /**
   * Positionering/bredd för dropdownen (default: fältets bredd). Smala fält
   * (sidofältet, dashboarden) vill ha en bredare panel, t.ex. "left-0 w-96".
   */
  dropdownClassName?: string;
}

/**
 * Sökfält med förslags-dropdown. MÅSTE ligga inuti ett GET-<form action="/produkter">
 * — Enter utan valt förslag och "Visa alla resultat" skickar formuläret som vanligt.
 * Förslagen hämtas debouncat från /api/search/suggest (serverns 24h-index i minnet,
 * ingen Neon-fråga per tangenttryckning) och cacheas per query i klienten.
 */
export function SearchAutocomplete({
  name = "q",
  id,
  defaultValue,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
  leading,
  trailing,
  dropdownClassName,
}: SearchAutocompleteProps) {
  const t = useTranslations("Products");
  const tCat = useTranslations("Category");
  const router = useRouter();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(new Map<string, Suggestion[]>());

  const [value, setValue] = useState(defaultValue ?? "");
  // null = inget hämtat för aktuell query än (dropdown hålls stängd tills svar finns).
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);

  const query = value.trim();
  const open = focused && query.length >= MIN_QUERY && results !== null;

  // Debouncad hämtning med abort + klient-cache.
  useEffect(() => {
    if (query.length < MIN_QUERY) {
      setResults(null);
      setActive(-1);
      return;
    }
    const key = query.toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached) {
      setResults(cached);
      setActive(-1);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Suggestion[] };
        if (cacheRef.current.size >= CLIENT_CACHE_MAX) cacheRef.current.clear();
        cacheRef.current.set(key, data.items);
        setResults(data.items);
        setActive(-1);
      } catch {
        // avbruten/nätverksfel — behåll det som visas
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // Stäng vid klick/tryck utanför (blur räcker inte — klick på förslag får inte stänga).
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !results) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length === 0 ? -1 : (a + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length === 0 ? -1 : a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      const chosen = active >= 0 ? results[active] : undefined;
      if (chosen) {
        e.preventDefault();
        setFocused(false);
        router.push(`/produkter/${chosen.slug}`);
      }
      // annars: vanlig formulär-submit → fulla sökresultat
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative flex items-center", className)}>
      {leading}
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        className={cn(
          "w-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none",
          inputClassName
        )}
      />
      {trailing}

      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-2 overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl shadow-black/40",
            dropdownClassName ?? "inset-x-0"
          )}
        >
          <ul id={listId} role="listbox" className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {results.map((s, i) => (
              <li key={s.slug} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <Link
                  href={`/produkter/${s.slug}`}
                  prefetch={false}
                  onClick={() => setFocused(false)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 transition-colors",
                    i === active && "bg-surface-overlay"
                  )}
                >
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-10 shrink-0 rounded-md bg-surface-overlay object-contain p-0.5"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-overlay text-ink-faint">
                      <IconCards size={18} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{s.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {s.setName ?? tCat(s.category)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {results.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-muted">{t("suggestEmpty")}</li>
            )}
          </ul>
          <button
            type="submit"
            className="block w-full border-t border-surface-border px-3 py-2.5 text-left text-sm font-semibold text-holo-cyan transition-colors hover:bg-surface-overlay"
          >
            {t("suggestShowAll", { query })}
          </button>
        </div>
      )}
    </div>
  );
}
