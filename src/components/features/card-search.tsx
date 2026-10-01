"use client";

/**
 * MANUELL KORTSÖKNING — skannerns detaljark (2026-09-23) och graderingens
 * "Fel kort?" (2026-10-01). Utbruten ur skannersidan så att båda väljer kort
 * på EXAKT samma sätt.
 *
 * En fråga per paus i skrivandet (debounce), aldrig per tangent: varje sökning är
 * en katalogfråga mot databasen. Resultaten har skanningens kandidatform
 * (`/api/scanner/search`), så ett val går samma väg som ett val ur raden.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { IconChevronLeft } from "@/components/ui/icons";
import { formatPrice } from "@/lib/format";

/** Det sökningen behöver av en kandidat — skannerns `Candidate` bär mer. */
export interface CardSearchCandidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  imageUrl: string | null;
  slug: string | null;
  productId: string | null;
  variantLabel: string | null;
  variants?: { productId: string; label: string | null; slug: string; estimatedValue: number | null }[];
  estimatedValue: number | null;
}

const SEARCH_DEBOUNCE_MS = 350;

export function CardSearch<C extends CardSearchCandidate>(props: {
  /** Användarens egen bild bredvid fältet: man skriver det man SER på kortet. */
  captured?: string | null;
  initialQuery: string;
  selectedCardId: string | null;
  onPick: (c: C) => void;
  onBack?: () => void;
  /** Skannern skickar enhets-id:t (gäster); default är en vanlig fetch. */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const t = useTranslations("Scanner");
  const [query, setQuery] = useState(props.initialQuery);
  const [results, setResults] = useState<C[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const fetcher = props.fetcher ?? fetch;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setState("loading");
      fetcher(`/api/scanner/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { candidates?: C[] }) => {
          setResults(d.candidates ?? []);
          setState("idle");
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setState("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // fetcher är en stabil modulfunktion hos båda anroparna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // En rad per TRYCKNING — samma regel som raden (reverse holo ska gå att välja).
  const rows = useMemo(
    () =>
      (results ?? []).flatMap((c) =>
        c.variants && c.variants.length > 1
          ? c.variants.map((v) => ({
              ...c,
              productId: v.productId,
              variantLabel: v.label,
              slug: v.slug,
              estimatedValue: v.estimatedValue,
            }))
          : [c]
      ),
    [results]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {props.onBack && (
          <button
            type="button"
            onClick={props.onBack}
            aria-label={t("searchCardBack")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-overlay text-ink ring-1 ring-surface-border"
          >
            <IconChevronLeft size={18} />
          </button>
        )}
        {props.captured && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.captured}
            alt={t("yourImage")}
            className="h-12 w-[2.15rem] shrink-0 rounded object-cover ring-1 ring-surface-border"
          />
        )}
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchCardPlaceholder")}
          className="h-11 min-w-0 flex-1 rounded-xl bg-surface-overlay px-3 text-base text-ink placeholder:text-ink-faint ring-1 ring-surface-border focus:outline-none focus:ring-holo-cyan/60"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {query.trim().length < 2 ? (
          <p className="px-1 py-4 text-sm text-ink-faint">{t("searchCardHint")}</p>
        ) : state === "error" ? (
          <p className="px-1 py-4 text-sm text-fall">{t("searchCardError")}</p>
        ) : results == null || (state === "loading" && rows.length === 0) ? (
          <p className="px-1 py-4 text-sm text-ink-faint">…</p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-4 text-sm text-ink-faint">{t("searchCardEmpty")}</p>
        ) : (
          <ul className={`flex flex-col gap-1.5 ${state === "loading" ? "opacity-60" : ""}`}>
            {rows.map((c) => {
              const selected = c.cardId === props.selectedCardId;
              return (
                <li key={`${c.cardId}:${c.productId ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => props.onPick(c)}
                    className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ring-1 transition-colors ${
                      selected
                        ? "bg-holo-cyan/10 ring-holo-cyan/50"
                        : "bg-surface-overlay/40 ring-surface-border hover:bg-surface-overlay"
                    }`}
                  >
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        loading="lazy"
                        className="h-16 w-[2.85rem] shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-16 w-[2.85rem] shrink-0 rounded bg-surface-overlay" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                      <span className="block truncate text-xs">
                        <span className="tabular-nums text-ink-muted">#{c.number}</span>
                        <span className="text-ink-faint"> · </span>
                        <span className="font-medium text-holo-cyan">
                          {c.variantLabel ?? t("ordinaryPrinting")}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-ink-faint">{c.setName}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {c.estimatedValue != null ? formatPrice(c.estimatedValue) : "–"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
