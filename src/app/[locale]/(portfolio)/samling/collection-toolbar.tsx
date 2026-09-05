"use client";

/**
 * Sök- och sorteringsraden i samlingen — EN komponent för BÅDA ytorna
 * (desktoptabellen och mobilrutnätet), så kontrollerna heter och beter sig
 * likadant oavsett var man står.
 *
 * Allt arbete sker i minnet på rader som redan är hämtade (se
 * `collection-filter.ts`); den här filen är bara kontrollerna.
 *
 * ⛔ Raden bor INNE i sidans behållare och bleedar aldrig (`-mx-2.5`): den delar
 * sidans vågräta luft med rutnätet nedanför, annars blir sökfältet bredare än
 * korten och kan skjuta utanför viewporten på mobil (se .claude/rules/ui-shell.md).
 */
import { useTranslations } from "next-intl";
import { Input, Select } from "@/components/ui/input";
import { IconChevronDown, IconSearch, IconX } from "@/components/ui/icons";
import { COLLECTION_SORTS, isCollectionSort, type CollectionSort } from "./collection-filter";

export function CollectionToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  matchCount,
  totalCount,
  idPrefix,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sort: CollectionSort;
  onSortChange: (value: CollectionSort) => void;
  /** Antal VAROR som visas efter filtrering (grupper, inte poster). */
  matchCount: number;
  /** Antal varor totalt — nämnaren i "x av y". */
  totalCount: number;
  /** Unikt prefix så desktopens och mobilens fält aldrig delar id (båda finns i DOM:en). */
  idPrefix: string;
  className?: string;
}) {
  const t = useTranslations("Collection");
  const active = query.trim().length > 0;

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <Input
            id={`${idPrefix}-filter`}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("filterPlaceholder")}
            aria-label={t("filterLabel")}
            // `type="search"` ger sökknapp på telefontangentbordet, men WebKit
            // ritar då OCKSÅ ett eget kryss — vårt egna sitter kvar (det är det
            // som har en etikett för skärmläsare), webbläsarens göms.
            className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {active && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("filterClear")}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-overlay/50 hover:text-ink"
            >
              <IconX size={16} />
            </button>
          )}
        </div>

        {/* Sorteringen är en NATIV select: den öppnar systemets hjulväljare på
            telefon (ett eget ark hade varit en andra implementation av något
            appen redan har). `Select` är appearance-none → chevronen ritas här. */}
        <div className="relative shrink-0">
          <Select
            id={`${idPrefix}-sort`}
            value={sort}
            onChange={(e) => {
              if (isCollectionSort(e.target.value)) onSortChange(e.target.value);
            }}
            aria-label={t("sortLabel")}
            className="w-auto max-w-[48vw] pr-8 sm:max-w-none"
          >
            {COLLECTION_SORTS.map((value) => (
              <option key={value} value={value}>
                {t(SORT_LABEL_KEYS[value])}
              </option>
            ))}
          </Select>
          <IconChevronDown
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
      </div>

      {/* Träffräknaren visas BARA när ett filter är aktivt — utan filter är
          "173 av 173" bara brus. */}
      {active && matchCount > 0 && (
        <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
          {t("filterMatchCount", { count: matchCount, total: totalCount })}
        </p>
      )}
    </div>
  );
}

/** Etikettnycklar per sorteringsval — hålls ihop med `COLLECTION_SORTS`. */
const SORT_LABEL_KEYS: Record<CollectionSort, string> = {
  recent: "sortRecent",
  value: "sortValue",
  name: "sortName",
  quantity: "sortQuantity",
};
