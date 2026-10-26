"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { countQuery, type CountSelection } from "@/lib/explore-count-query";
import { isSealedCategory } from "@/lib/product-category";
import { InstantResults, SearchRecents, type InstantKind } from "@/components/features/explore-instant-search";
import { rememberSearch } from "@/lib/search-history";
import { onProductOverlayOpen, registerFullscreenHost } from "@/lib/product-overlay-open";
import { SafeImage } from "@/components/ui/safe-image";
import { SetNameTile } from "@/components/features/set-name-tile";
import { isRealSetLogo } from "@/lib/set-logo";
import { isSetListed } from "@/lib/set-listing";
import { eraRank, setEra, type Era } from "@/lib/set-era";
import { useOwnedSets } from "@/lib/owned-sets";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { IconCards, IconCheck, IconChevronDown, IconChevronRight, IconFilter, IconSearch, IconX } from "@/components/ui/icons";

export interface FilterSet {
  id: string;
  name: string;
  logoUrl: string | null;
  series: string;
  /** "EN" | "JP" — styr vilken flik setet ligger under i set-arket. */
  language: string;
  /** Era + listning (lib/set-era, lib/set-listing). Datum som sträng efter cachen. */
  releaseDate?: Date | string | null;
  externalId?: string | null;
  /** Framstegets nämnare (tryckningar, annars kort). null = okänt. */
  total?: number | null;
}

export interface FilterOption {
  value: string;
  label: string;
}

/** Rå URL-state (svenska parameternamn — samma som /produkter läser server-sida). */
export interface ExploreSearchParams {
  q?: string;
  kategori?: string;
  set?: string;
  butik?: string;
  minPris?: string;
  maxPris?: string;
  lager?: string;
  sprak?: string;
  sortera?: string;
  sida?: string;
}

interface ExploreFilterBarProps {
  searchParams: ExploreSearchParams;
  sets: FilterSet[];
  retailers: FilterOption[];
  categories: FilterOption[];
  languages: FilterOption[];
  /** value = URL-värde för ?sortera, label = översatt etikett. Index 0 = default. */
  sortOptions: FilterOption[];
  /** Antal träffar för de filter som FAKTISKT är applicerade (server-sanning). */
  total: number;
}

/**
 * Reglagets topp. Taket är BARA reglagets räckvidd, inte katalogens: `max = null`
 * betyder inget tak alls (dyra singlar ligger långt över 5 000 kr), och skriver
 * man in ett eget värde i Till-fältet får det gärna vara högre än taket — då
 * ligger handtaget i topp medan siffran gäller.
 */
const PRICE_MAX = 5000;
const PRICE_STEP = 50;

/** null = inget tak. */
type MaxKr = number | null;

const PRICE_SHORTCUTS: [number, MaxKr][] = [
  [0, null],
  [0, 200],
  [200, 500],
  [500, 1000],
  [1000, null],
];

type SheetKind = "sort" | "set" | "price" | "more" | "lang";

/** Urval som ska räknas — URL-statet med de val man håller på att göra inbakade. */
type PendingSelection = ExploreSearchParams & CountSelection;

/**
 * Antalet träffar för det man håller på att välja, INNAN man tryckt på knappen.
 * Knappen visade förut antalet för de redan applicerade filtren, så man kryssade i
 * "Elite Trainer Box" och fick ändå läsa "22 233 produkter" — man valde i blindo.
 *
 * FÖRDRÖJT MED FLIT (`DEBOUNCE_MS`): ett drag i prisreglaget ändrar värdet dussintals
 * gånger, och en COUNT per pixel mot Neon är precis den kostnaden vi undvek när
 * filtret byggdes. Nu blir ett drag ETT anrop när handen stannar. Föregående anrop
 * avbryts (AbortController) så ett långsamt svar aldrig skriver över ett nyare.
 * Faller tillbaka på serverns applicerade `total` tills första svaret kommit.
 */
const COUNT_DEBOUNCE_MS = 280;

function usePendingCount(open: boolean, selection: PendingSelection, fallback: number): number {
  const [count, setCount] = useState<number | null>(null);
  const query = countQuery(selection);

  useEffect(() => {
    if (!open) {
      setCount(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/count?${query}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (typeof data.count === "number") setCount(data.count);
      } catch {
        // Avbrutet eller nätverksfel → behåll siffran vi redan visar.
      }
    }, COUNT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [open, query]);

  return count ?? fallback;
}

function krLabel(kr: number): string {
  return `${kr.toLocaleString("sv-SE")} kr`;
}

/**
 * Utforska-filtren på mobil: sökfältet med "Sortera och filtrera" i högerkanten och
 * en chip-rad Set · Kort · Förseglat under (designpasset 2026-10-25 — färre val,
 * resten bakom ikonen). Ett tryck i fältet öppnar sökläget (senaste sökningar →
 * direktträffar, se explore-instant-search.tsx).
 *
 * Filtren lever i URL:en (samma parametrar som desktop-sidofältet skickar), så en
 * delad länk bär hela vyn och serverns `total` alltid stämmer med det som visas.
 */
export function ExploreFilterBar({
  searchParams,
  sets,
  retailers,
  categories,
  languages,
  sortOptions,
  total,
}: ExploreFilterBarProps) {
  const t = useTranslations("Products");
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  const defaultSort = sortOptions[0]?.value ?? "popular";
  const sort = sortOptions.some((o) => o.value === searchParams.sortera)
    ? (searchParams.sortera as string)
    : defaultSort;
  const sortActive = sort !== defaultSort;

  /**
   * KORT · FÖRSEGLAT (designpasset 2026-10-25): två ömsesidigt uteslutande chips som
   * skriver samma `kategori`-parameter som "Mer"-arket — inga nya URL-parametrar, så
   * delade länkar och bakåtknappen fungerar som förut. Förseglat = hela sealed-knippet
   * (samma expansion som "Alla sealed"). En annan kategorilista (t.ex. bara ETB) är
   * ett filter bakom ikonen och tänder ingen av dem.
   */
  const sealedValues = useMemo(
    () => categories.map((c) => c.value).filter(isSealedCategory),
    [categories]
  );
  const kindOf = (kategori: string | undefined): InstantKind => {
    const list = csvList(kategori);
    if (list.length === 1 && list[0] === "SINGLE_CARD") return "cards";
    if (
      sealedValues.length > 0 &&
      list.length === sealedValues.length &&
      sealedValues.every((v) => list.includes(v))
    )
      return "sealed";
    return null;
  };
  const kindParam = (kind: InstantKind): string | undefined =>
    kind === "cards" ? "SINGLE_CARD" : kind === "sealed" ? sealedValues.join(",") : undefined;

  /**
   * SÖKLÄGET: ett tryck i fältet gör raden till en helskärmsvy (senaste sökningar →
   * direktträffar). Chipsen ändrar då ett LOKALT urval som gäller träffarna och följer
   * med när man visar alla — en navigering per tryck hade monterat om formuläret
   * (key={filterKey}) och tagit fokus och tangentbord med sig.
   */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(searchParams.q ?? "");
  const [localKind, setLocalKind] = useState<InstantKind>(() => kindOf(searchParams.kategori));
  const [localSets, setLocalSets] = useState<string[]>(() => csvList(searchParams.set));
  const [localLang, setLocalLang] = useState<string | null>(() => langOf(searchParams.sprak));
  // Antalet träffar i direktsöket — visas på flikraden medan man skriver.
  const [instantTotal, setInstantTotal] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const urlKind = kindOf(searchParams.kategori);
  const urlKategori = searchParams.kategori;
  // Sökläget ritar det lokala urvalet; annars är URL:en sanningen.
  const shownKind = searching ? localKind : urlKind;
  const activeSetIds = searching ? localSets : csvList(searchParams.set);
  const urlLang = langOf(searchParams.sprak);
  const shownLang = searching ? localLang : urlLang;

  // Logotypen i chipet bara vid ETT set — flera logotyper får inte plats.
  const soleActiveSet = activeSetIds.length === 1 ? (sets.find((s) => s.id === activeSetIds[0]) ?? null) : null;
  const activeSetLabel =
    activeSetIds.length === 0
      ? null
      : activeSetIds.length === 1
        ? (sets.find((s) => s.id === activeSetIds[0])?.name ?? t("set"))
        : t("setsSelected", { count: activeSetIds.length });

  const minKr = parseKr(searchParams.minPris) ?? 0;
  const maxKr: MaxKr = parseKr(searchParams.maxPris);
  const priceActive = minKr > 0 || maxKr !== null;
  // "I lager"-chipet är borttaget (ägarbeslut 2026-10-25); en gammal länk med
  // ?lager=1 gäller fortfarande och syns som ett aktivt filter bakom ikonen.
  const inStock = searchParams.lager === "1";

  // Kategorier som inte är exakt Kort/Förseglat räknas som "Mer"-filter.
  const otherKategori = urlKind === null ? csvList(urlKategori).length : 0;
  // Språket har en egen flik i raden sedan 2026-10-25; bara butik + övriga kategorier räknas här.
  const moreCount = otherKategori + csvList(searchParams.butik).length + (urlLang === null ? csvList(searchParams.sprak).length : 0);
  const filterActive = sortActive || priceActive || inStock || moreCount > 0;

  /** Bygger nästa URL. `sida` nollställs alltid — sida 3 av ett annat filter är inte sida 3. */
  function pushParams(patch: Partial<Record<keyof ExploreSearchParams, string | undefined>>) {
    const next: ExploreSearchParams = { ...searchParams, ...patch, sida: undefined };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined && value !== "") usp.set(key, value);
    }
    const qs = usp.toString();
    router.push(qs ? `/produkter?${qs}` : "/produkter");
  }

  function chooseKind(kind: InstantKind) {
    if (searching) setLocalKind(kind);
    else pushParams({ kategori: kindParam(kind) });
  }

  function chooseLang(lang: string | null) {
    setSheet(null);
    if (searching) setLocalLang(lang);
    else pushParams({ sprak: lang ?? undefined });
  }

  /** Lokalt urval i sökläget → kategori-/set-/språkparametrarna (övriga filter följer med som de är). */
  function searchPatch(q: string) {
    return {
      q: q.trim() || undefined,
      kategori: localKind !== urlKind ? kindParam(localKind) : urlKategori,
      set: localSets.length > 0 ? localSets.join(",") : undefined,
      sprak: localLang !== urlLang ? (localLang ?? undefined) : searchParams.sprak,
    };
  }

  function submitSearch(q: string) {
    if (q.trim().length >= 2) rememberSearch(q);
    inputRef.current?.blur();
    pushParams(searchPatch(q));
  }

  function enterSearch() {
    if (searching) return;
    setLocalKind(urlKind);
    setLocalSets(csvList(searchParams.set));
    setLocalLang(urlLang);
    setSearching(true);
  }

  function cancelSearch() {
    setQuery(searchParams.q ?? "");
    setSearching(false);
    inputRef.current?.blur();
  }

  // Medan sökläget är uppe: produkt-overlayn lyfts över det (samma mekanism som
  // skannern), sidan bakom står still, och en öppnad träff räknas som en sökning.
  useEffect(() => {
    if (!searching) return;
    const release = registerFullscreenHost();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const off = onProductOverlayOpen(() => {
      const q = inputRef.current?.value ?? "";
      if (q.trim().length >= 2) rememberSearch(q);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      release();
      off();
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  const priceLabel = !priceActive
    ? t("priceShort")
    : maxKr === null
      ? `${minKr.toLocaleString("sv-SE")}+ kr`
      : minKr > 0
        ? `${minKr.toLocaleString("sv-SE")}–${maxKr.toLocaleString("sv-SE")} kr`
        : `≤ ${krLabel(maxKr)}`;

  /**
   * FILTERRADEN, STIL 2 (ägarbeslut 2026-10-25): ord med en tunn turkos linje under det
   * valda — Allt · Förseglat · Singlar · Språk · Set — och antalet på samma rad. Språk
   * glider upp som ett ark (samma BottomSheet som resten av appen), Set öppnar setarket.
   */
  const tabItems: { key: string; label: string; active: boolean; menu?: boolean; onClick: () => void }[] = [
    { key: "all", label: t("chipAll"), active: shownKind === null && otherKategori === 0, onClick: () => chooseKind(null) },
    { key: "sealed", label: t("chipSealed"), active: shownKind === "sealed", onClick: () => chooseKind("sealed") },
    { key: "cards", label: t("chipSingles"), active: shownKind === "cards", onClick: () => chooseKind("cards") },
    { key: "lang", label: shownLang ?? t("language"), active: shownLang !== null, menu: true, onClick: () => setSheet("lang") },
    { key: "set", label: activeSetLabel ?? t("set"), active: activeSetLabel !== null, menu: true, onClick: () => setSheet("set") },
  ];
  const chips = (
    <div className="-mx-2.5 flex items-center border-b border-surface-overlay px-2.5">
      <div
        className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x pan-y" }}
      >
        {tabItems.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={tab.onClick}
            aria-pressed={tab.menu ? undefined : tab.active}
            aria-haspopup={tab.menu ? "dialog" : undefined}
            className={cn(
              "relative flex h-9 max-w-[9rem] shrink-0 items-center gap-1 text-[13.5px] outline-none transition-colors focus-visible:text-holo-cyan",
              tab.active ? "font-bold text-ink" : "font-medium text-ink-faint"
            )}
          >
            {tab.key === "set" && soleActiveSet?.logoUrl && (
              <SafeImage src={soleActiveSet.logoUrl} alt="" className="h-3.5 w-[24px] shrink-0 object-contain" fallback={<></>} />
            )}
            <span className="truncate">{tab.label}</span>
            {tab.menu && <IconChevronDown size={11} strokeWidth={3} className="shrink-0" />}
            <span
              aria-hidden
              className={cn("absolute inset-x-0 -bottom-px h-0.5 rounded-full", tab.active ? "bg-holo-cyan" : "bg-transparent")}
            />
          </button>
        ))}
      </div>
      {(() => {
        const shown = !searching ? total : query.trim().length >= 2 ? instantTotal : null;
        return shown == null ? null : (
          <span aria-live="polite" className="shrink-0 whitespace-nowrap pl-3 text-xs tabular-nums text-ink-faint">
            {t("resultCountShort", { count: shown })}
          </span>
        );
      })()}
    </div>
  );

  return (
    <div
      className={cn(
        searching
          ? // Helskärm OVANPÅ sidhuvudet (z-40) och flikarna; overlayn lyfts till z-70.
            "fixed inset-0 z-[45] flex flex-col bg-surface px-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)]"
          : "space-y-3"
      )}
    >
      {/* Dolda fält: Enter utan JS skickar formuläret — utan dem tappas aktiva filter. */}
      <HiddenFilters
        searchParams={
          searching
            ? { ...searchParams, ...searchPatch(query), q: undefined }
            : searchParams
        }
      />

      {/* ⛔ Samma fält-nod i båda lägena — bara klasserna byts. Byts noden tappar
          iOS fokus och tangentbordet stängs mitt i trycket. */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 transition-colors focus-within:border-holo-cyan/60">
          <IconSearch size={18} className="shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            name="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={enterSearch}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch(query);
              }
            }}
            placeholder={t("mobileSearchPlaceholder")}
            aria-label={t("mobileSearchPlaceholder")}
            autoComplete="off"
            enterKeyHint="search"
            className="w-full min-w-0 flex-1 bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {searching && query.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("clearSearch")}
              className="-mr-1.5 grid h-11 w-9 shrink-0 place-items-center"
            >
              <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-ink-faint/40 text-surface">
                <IconX size={11} strokeWidth={3} />
              </span>
            </button>
          ) : !searching ? (
            <button
              type="button"
              onClick={() => setSheet("sort")}
              aria-label={t("sortAndFilter")}
              className="-mr-1.5 flex h-11 shrink-0 items-center justify-center px-1.5"
            >
              {/* Bara ikonen — ingen platta bakom. Aktiva filter/sortering syns på FÄRGEN. */}
              <span
                className={cn(
                  "grid h-[30px] w-[30px] place-items-center transition-colors",
                  filterActive ? "text-holo-cyan" : "text-ink"
                )}
              >
                <IconFilter size={18} />
              </span>
            </button>
          ) : null}
        </div>
        {searching && (
          <button
            type="button"
            onClick={cancelSearch}
            className="shrink-0 px-1 py-2 text-[15px] font-medium text-holo-cyan"
          >
            {t("cancelSearch")}
          </button>
        )}
      </div>

      {chips}

      {searching && (
        // Ett svep i träffarna fäller tangentbordet (ägaren 2026-10-26); sökläget står kvar
        // och ett tryck i fältet tar fram det igen.
        <div
          className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5"
          onTouchMove={() => {
            if (document.activeElement === inputRef.current) inputRef.current?.blur();
          }}
        >
          {query.trim().length >= 2 ? (
            <InstantResults
              query={query}
              kind={localKind}
              setIds={localSets}
              lang={localLang}
              onTotal={setInstantTotal}
              onShowAll={() => submitSearch(query)}
            />
          ) : (
            <SearchRecents
              onPick={(q) => {
                setQuery(q);
                rememberSearch(q);
              }}
            />
          )}
        </div>
      )}

      {/* SORTERA OCH FILTRERA: ikonen i fältet. Pris och "Mer" (språk, butik,
          kategori) bor här sedan chip-raden krympte till Set · Kort · Förseglat. */}
      <Sheet
        open={sheet === "sort"}
        title={t("sortAndFilter")}
        onClose={() => setSheet(null)}
        onClear={
          filterActive
            ? () => {
                pushParams({
                  sortera: undefined,
                  minPris: undefined,
                  maxPris: undefined,
                  lager: undefined,
                  butik: undefined,
                  sprak: undefined,
                  kategori: urlKind !== null ? urlKategori : undefined,
                });
                setSheet(null);
              }
            : undefined
        }
        cta={t("resultCount", { count: total })}
      >
        <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          {t("filterSection")}
        </p>
        <div className="flex flex-col gap-0.5">
          <FilterRow label={t("priceShort")} value={priceActive ? priceLabel : null} onClick={() => setSheet("price")} />
          <FilterRow
            label={t("moreFiltersLong")}
            value={moreCount > 0 ? String(moreCount) : null}
            onClick={() => setSheet("more")}
          />
          {inStock && (
            <FilterRow
              label={t("inStockShort")}
              value={t("on")}
              onClick={() => {
                pushParams({ lager: undefined });
                setSheet(null);
              }}
              clear
            />
          )}
        </div>
        <p className="mb-1 mt-4 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          {t("sortBy")}
        </p>
        <div className="flex flex-col gap-0.5">
          {sortOptions.map((o) => {
            const selected = o.value === sort;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  pushParams({ sortera: o.value === defaultSort ? undefined : o.value });
                  setSheet(null);
                }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                  selected ? "bg-holo-cyan/10 text-holo-cyan" : "text-ink"
                )}
              >
                {o.label}
                {selected && <IconCheck size={17} className="shrink-0 text-holo-cyan" />}
              </button>
            );
          })}
        </div>
        {/* Rankningstransparens (EU:s Omnibus-regler): förklaringen av "Bäst
            matchning" ska gå att nå därifrån rangordningen visas — inte bara
            ligga i villkoren. Nedtonad (ägarbeslut 2026-08-09) men ALDRIG
            borttagen. */}
        <Link
          href="/om#ranking"
          className="mt-1 block px-3 py-1.5 text-[11px] text-ink-faint/60 underline-offset-2 hover:text-ink-muted hover:underline"
        >
          {t("howWeRank")}
        </Link>
      </Sheet>

      {/* Samma rader som sorteringen i filterarket — ett tryck väljer och stänger. */}
      <BottomSheet open={sheet === "lang"} title={t("language")} onClose={() => setSheet(null)} closeLabel={t("closeSheet")}>
        <div className="flex flex-col gap-0.5 pb-6">
          {[{ value: null as string | null, label: t("allLanguages") }, ...languages].map((l) => {
            const selected = shownLang === l.value;
            return (
              <button
                key={l.value ?? "all"}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => chooseLang(l.value)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                  selected ? "bg-holo-cyan/10 text-holo-cyan" : "text-ink"
                )}
              >
                {l.label}
                {selected && <IconCheck size={17} className="shrink-0 text-holo-cyan" />}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <SetSheet
        open={sheet === "set"}
        sets={sets}
        activeSetIds={activeSetIds}
        baseSelection={{ ...searchParams, set: undefined }}
        total={total}
        onClose={() => setSheet(null)}
        onApply={(ids) => {
          if (searching) setLocalSets(ids);
          else pushParams({ set: ids.length > 0 ? ids.join(",") : undefined });
          setSheet(null);
        }}
        initialLang={searchParams.sprak === "JP" ? "JP" : searchParams.sprak === "EN" ? "EN" : undefined}
      />

      <PriceSheet
        open={sheet === "price"}
        searchParams={searchParams}
        minKr={minKr}
        maxKr={maxKr}
        total={total}
        onClose={() => setSheet(null)}
        onApply={(rawMin, rawMax) => {
          // Reglagen får passera varandra (att låta handtaget tvärstanna kändes
          // trasigt) — här rättas ordningen i stället.
          const lo = rawMax !== null && rawMax < rawMin ? rawMax : rawMin;
          const hi = rawMax !== null && rawMax < rawMin ? rawMin : rawMax;
          pushParams({
            minPris: lo > 0 ? String(lo) : undefined,
            maxPris: hi !== null ? String(hi) : undefined,
          });
          setSheet(null);
        }}
      />

      <MoreSheet
        open={sheet === "more"}
        searchParams={searchParams}
        categories={categories}
        retailers={retailers}
        languages={languages}
        total={total}
        onClose={() => setSheet(null)}
        onApply={(patch) => {
          pushParams(patch);
          setSheet(null);
        }}
      />
    </div>
  );
}

/** En rad i "Sortera och filtrera" som öppnar ett eget ark. */
function FilterRow({
  label,
  value,
  onClick,
  clear,
}: {
  label: string;
  value: string | null;
  onClick: () => void;
  /** Raden STÄNGER AV filtret i stället för att öppna ett ark (gamla ?lager=1). */
  clear?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm text-ink"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1.5 text-ink-muted">
        {value && <span className="font-medium text-holo-cyan">{value}</span>}
        {clear ? <IconX size={15} /> : <IconChevronRight size={16} />}
      </span>
    </button>
  );
}

/* ──────────────────────────── Sheet ───────────────────────────── */

function Sheet({
  open,
  title,
  onClose,
  onClear,
  cta,
  onCta,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onClear?: () => void;
  /** Text efter "Visa " på bekräfta-knappen. */
  cta: string;
  onCta?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("Products");
  // Skalet (overlay, tangentbordslyft, panel, handtag, fot) bor i
  // ui/bottom-sheet.tsx sedan 2026-08-02 — snabbtillägget i samlingen skulle
  // kännas som filtren, och tangentbordsmätningen med sin Capacitor-fälla får
  // inte finnas i två exemplar. Här återstår bara filtrens EGNA copy.
  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onClose}
      closeLabel={t("closeSheet")}
      headerAction={onClear ? { label: t("clear"), onClick: onClear } : undefined}
      footer={
        <BottomSheetCta onClick={onCta ?? onClose}>
          {t("showResults", { results: cta })}
        </BottomSheetCta>
      }
    >
      {children}
    </BottomSheet>
  );
}

/* ────────────────────────── Set-sheet ─────────────────────────── */

/**
 * Exporterad sedan 2026-08-11: desktop-sidofältets "Bläddra bland alla set"
 * öppnar SAMMA ark (ägarbeslut — set väljs med logotypbrickor grupperade på
 * serie, en implementation). Kolumnantalet är därför responsivt; telefonen på
 * höjden får exakt de tre kolumner den alltid haft.
 */
export function SetSheet({
  open,
  sets,
  activeSetIds,
  baseSelection,
  total,
  onClose,
  onApply,
  initialLang,
}: {
  open: boolean;
  sets: FilterSet[];
  /** Applicerade set ur URL:en. FLERVAL sedan 2026-09-28 (`?set=a,b`). */
  activeSetIds: string[];
  /** Övriga applicerade filter — knappens antal räknas på dem + setvalet. */
  baseSelection: CountSelection;
  total: number;
  onClose: () => void;
  /** Tom lista = inget setfilter. */
  onApply: (ids: string[]) => void;
  /** Språkfiltrets val — arket öppnar på DEN fliken (ägaren 2026-09-17). Utan: EN. */
  initialLang?: "EN" | "JP";
}) {
  const t = useTranslations("Products");
  // Japanska set finns bara när vi säljer något ur dem (jp-set-label.ts) — saknas
  // de helt visas ingen flikrad alls, så EN-katalogen ser ut precis som förut.
  // Samma urval som /sets: däck/kit-set listas inte (lib/set-listing.ts) — utom de som redan är valda.
  const shownSets = useMemo(
    () => sets.filter((s) => activeSetIds.includes(s.id) || isSetListed({ name: s.name, language: s.language, externalId: s.externalId ?? null, releaseDate: s.releaseDate ?? null })),
    [sets, activeSetIds]
  );
  const jpSets = useMemo(() => shownSets.filter((s) => s.language === "JP"), [shownSets]);
  const enSets = useMemo(() => shownSets.filter((s) => s.language !== "JP"), [shownSets]);
  const { loggedIn, owned } = useOwnedSets();
  const [lang, setLang] = useState<"EN" | "JP">("EN");
  // FLERVAL (ägaren 2026-09-28): brickorna kryssas i och ur lokalt, knappen
  // applicerar — samma mönster som "Fler filter". Förut applicerade ett tryck
  // direkt och stängde arket, så det gick bara att välja ett set.
  const [picked, setPicked] = useState<string[]>(activeSetIds);
  const activeKey = activeSetIds.join(",");
  useEffect(() => {
    if (open) setPicked(activeKey ? activeKey.split(",") : []);
  }, [open, activeKey]);
  const pendingCount = usePendingCount(open, { ...baseSelection, set: picked.join(",") || undefined }, total);
  // Öppnar man arket med bara japanska set valda ska man landa på DERAS flik —
  // annars ser det ut som att valet försvunnit.
  const activeIsJp =
    activeSetIds.length > 0 && activeSetIds.every((id) => jpSets.some((s) => s.id === id));
  useEffect(() => {
    if (open) setLang(activeIsJp ? "JP" : (initialLang ?? "EN"));
  }, [open, activeIsJp, initialLang]);

  // EN rubrik per SERIE — inte en per löpande grupp. Listan kommer sorterad på
  // releaseDate (nyast först), och promo-/POP-set ligger inklämda mitt bland
  // huvudserierna (SWSH Black Star Promos 2022-08-03 hamnar mellan två Sword &
  // Shield-set). Den gamla logiken bröt en ny rubrik vid varje sådant hopp:
  // 65 rubriker för 17 serier, och "Sword & Shield" dök upp nio gånger — det såg
  // ut som om seten låg i fel serie. Map:en slår ihop dem i stället.
  // Serieordningen = där seriens NYASTE set ligger (först sedd), och inuti varje
  // serie står nyast först — samma ordning som /sets-sidan bygger.
  // Rubrik per ERA (lib/set-era.ts) — samma som /sets. Nyast era först, "Other" sist.
  const groupBySeries = (items: FilterSet[]) => {
    const byEra = new Map<Era, FilterSet[]>();
    for (const s of items) {
      const era = setEra({ name: s.name, language: s.language, series: s.series, releaseDate: s.releaseDate ?? null });
      const list = byEra.get(era);
      if (list) list.push(s);
      else byEra.set(era, [s]);
    }
    return [...byEra]
      .sort((a, b) => eraRank(a[0]) - eraRank(b[0]))
      .map(([era, group]) => ({ era, series: era === "Other" ? t("setEraOther") : era, items: group }));
  };
  const grouped = groupBySeries(enSets);
  // Japanska set grupperas på SAMMA sätt: serien kommer från TCGdex och skrivs med
  // den latinska eran ("Scarlet & Violet"), så rubrikerna läser likadant i båda
  // flikarna. Set vars era vi inte kunnat styrka ligger i "Other" — och eftersom
  // listan är sorterad på releaseDate (nulls sist) hamnar den gruppen sist av sig
  // själv, utan specialfall.
  const groupedJp = groupBySeries(jpSets);

  const tile = (s: FilterSet) => {
    const selected = picked.includes(s.id);
    const mine = owned?.[s.id]?.owned ?? 0;
    const dim = loggedIn === true && owned !== null && mine === 0 && !selected;
    const logo = isRealSetLogo(s.logoUrl) ? s.logoUrl : null;
    const pct = s.total ? Math.min(100, (mine / s.total) * 100) : 0;
    return (
      <button
        key={s.id}
        type="button"
        aria-pressed={selected}
        onClick={() => setPicked((prev) => (selected ? prev.filter((id) => id !== s.id) : [...prev, s.id]))}
        className="flex flex-col gap-1.5 text-center"
      >
        <span
          className={cn(
            "relative flex h-16 items-center justify-center overflow-hidden rounded-[10px] border bg-surface px-2 transition-all",
            selected ? "border-holo-cyan shadow-glow" : "border-surface-border"
          )}
        >
          {logo ? (
            <SafeImage
              src={logo}
              alt=""
              className={cn("max-h-full max-w-full object-contain transition", dim && "opacity-60 saturate-[0.25]")}
              fallback={<SetNameTile name={s.name} compact />}
            />
          ) : (
            <SetNameTile name={s.name} compact className={cn(dim && "opacity-60")} />
          )}
          {/* Framstegsstapeln (foliekant) längst ned i brickan. */}
          {mine > 0 && s.total ? (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-overlay">
              <span className="block h-full bg-gradient-to-r from-holo-cyan via-holo-violet to-holo-pink" style={{ width: pct + "%" }} />
            </span>
          ) : null}
          {selected && (
            <span className="absolute right-1 top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-holo-cyan text-surface">
              <IconCheck size={10} strokeWidth={3.4} />
            </span>
          )}
        </span>
        <span className={cn("line-clamp-2 text-[11px] font-medium leading-snug", dim ? "text-ink-muted" : "text-ink")}>{s.name}</span>
        {loggedIn && s.total ? (
          <span className={cn("-mt-1 text-[10px] tabular-nums", mine > 0 ? "text-holo-cyan" : "text-ink-faint")}>
            {mine}/{s.total}
          </span>
        ) : null}
      </button>
    );
  };



  return (
    <Sheet
      open={open}
      title={t("chooseSet")}
      onClose={onClose}
      onClear={picked.length > 0 ? () => setPicked([]) : undefined}
      cta={t("resultCount", { count: pendingCount })}
      onCta={() => onApply(picked)}
    >
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-surface-border">
        {jpSets.length > 0 ? (
        <div role="tablist" className="flex gap-6">
          {(["EN", "JP"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                // Fliken byter BARA listan i arket (ägaren 2026-10-16: förut applicerades
                // språkfiltret och arket stängdes, så man fick öppna det igen).
                setLang(code);
              }}
              role="tab"
              aria-selected={lang === code}
              className={cn(
                "relative -mb-px border-b-2 pb-2 text-sm font-semibold transition-colors",
                lang === code ? "border-holo-cyan text-ink" : "border-transparent text-ink-muted hover:text-ink"
              )}
            >
              {code === "EN" ? t("setLanguageEn") : t("setLanguageJp")}
              <span className="ml-1.5 text-xs font-normal text-ink-faint">{code === "EN" ? enSets.length : jpSets.length}</span>
            </button>
          ))}
        </div>
        ) : (
          <span />
        )}
      </div>

      <div className="space-y-5 pb-2">
        {(lang === "JP" ? groupedJp : grouped).map((group) => (
          <div key={group.series}>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {group.series}
            </p>
            {/* md/xl-stegen gäller bara när arket öppnas från desktop-sidofältet —
                mobilens filterrad renderas enbart under lg. */}
            <div className="grid grid-cols-3 gap-2.5 md:grid-cols-5 xl:grid-cols-8">{group.items.map(tile)}</div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────────────────────── Pris-sheet ─────────────────────────── */

function PriceSheet({
  open,
  searchParams,
  minKr,
  maxKr,
  total,
  onClose,
  onApply,
}: {
  open: boolean;
  searchParams: ExploreSearchParams;
  minKr: number;
  maxKr: MaxKr;
  total: number;
  onClose: () => void;
  onApply: (min: number, max: MaxKr) => void;
}) {
  const t = useTranslations("Products");
  const [min, setMin] = useState(minKr);
  const [max, setMax] = useState<MaxKr>(maxKr);

  // Sheeten monteras/avmonteras med `open` → synka in URL-värdet varje gång den öppnas.
  useEffect(() => {
    if (open) {
      setMin(minKr);
      setMax(maxKr);
    }
  }, [open, minKr, maxKr]);

  // Antalet för intervallet man håller på att ställa in — uppdateras när handen
  // stannar, inte per pixel (se usePendingCount).
  const pendingCount = usePendingCount(open, { ...searchParams, minKr: min, maxKr: max }, total);

  return (
    <Sheet
      open={open}
      title={t("priceRange")}
      onClose={onClose}
      onClear={min > 0 || max !== null ? () => onApply(0, null) : undefined}
      cta={t("resultCount", { count: pendingCount })}
      onCta={() => onApply(min, max)}
    >
      <div className="pb-2">
        {/* Fälten är REDIGERBARA — reglaget är grovt (50 kr/steg, 0–5 000) och
            duger inte för "visa mig allt över 12 000". Tomt Till-fält = inget tak. */}
        <div className="mb-4 flex items-end justify-center gap-2.5">
          <label className="flex-1 rounded-[9px] border border-surface-border px-3 py-2 focus-within:border-holo-cyan/60">
            <span className="block text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {t("priceFrom")}
            </span>
            <span className="flex items-baseline gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={PRICE_MAX}
                value={min === 0 ? "" : min}
                placeholder="0"
                onChange={(e) => setMin(parseKrInput(e.target.value) ?? 0)}
                aria-label={t("minAria")}
                className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] font-bold tabular-nums text-ink outline-none placeholder:text-ink-faint [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="shrink-0 text-[11px] text-ink-faint">kr</span>
            </span>
          </label>
          <span className="shrink-0 pb-2 text-ink-faint">–</span>
          <label className="flex-1 rounded-[9px] border border-surface-border px-3 py-2 focus-within:border-holo-cyan/60">
            <span className="block text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {t("priceTo")}
            </span>
            <span className="flex items-baseline gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={max ?? ""}
                placeholder={t("priceNoMax")}
                onChange={(e) => setMax(parseKrInput(e.target.value))}
                aria-label={t("maxAria")}
                className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] font-bold tabular-nums text-holo-cyan outline-none placeholder:font-semibold placeholder:text-ink-faint [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="shrink-0 text-[11px] text-ink-faint">kr</span>
            </span>
          </label>
        </div>

        {/* `touch-action: none` — utan den tolkade sheetens scroll-container varje
            drag som en ansats till lodrät scroll och reglaget "hakade upp sig"
            mitt i rörelsen. Reglagen klampar INTE mot varandra längre: de får
            passera, och värdena byter plats vid tillämpning (`onApply`). Att låta
            handtaget tvärstanna mot det andra var precis det som kändes trasigt. */}
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2.5">
            <span className="w-7 shrink-0 text-[10.5px] font-medium text-ink-faint">
              {t("min")}
            </span>
            <input
              type="range"
              min={0}
              max={PRICE_MAX}
              step={PRICE_STEP}
              value={Math.min(min, PRICE_MAX)}
              onChange={(e) => setMin(Number(e.target.value))}
              style={{ touchAction: "none" }}
              className="h-8 flex-1 cursor-pointer bg-transparent accent-holo-cyan"
              aria-label={t("minAria")}
            />
          </label>
          <label className="flex items-center gap-2.5">
            <span className="w-7 shrink-0 text-[10.5px] font-medium text-ink-faint">
              {t("max")}
            </span>
            <input
              type="range"
              min={0}
              max={PRICE_MAX}
              step={PRICE_STEP}
              // Reglaget i topp = INGET tak (null), inte "exakt 5 000 kr".
              value={max === null ? PRICE_MAX : Math.min(max, PRICE_MAX)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMax(v >= PRICE_MAX ? null : v);
              }}
              style={{ touchAction: "none" }}
              className="h-8 flex-1 cursor-pointer bg-transparent accent-holo-cyan"
              aria-label={t("maxAria")}
            />
          </label>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {PRICE_SHORTCUTS.map(([lo, hi]) => {
            const active = min === lo && max === hi;
            const label =
              lo === 0 && hi === null
                ? t("priceAll")
                : hi === null
                  ? `${lo.toLocaleString("sv-SE")}+`
                  : `${lo.toLocaleString("sv-SE")}–${hi.toLocaleString("sv-SE")}`;
            return (
              <button
                key={`${lo}-${hi}`}
                type="button"
                onClick={() => {
                  setMin(lo);
                  setMax(hi);
                }}
                className={cn(
                  "min-w-[64px] flex-1 whitespace-nowrap rounded-lg border px-1 py-2.5 text-[11.5px] font-semibold transition-colors",
                  active
                    ? "border-holo-cyan/45 bg-holo-cyan/[0.12] text-holo-cyan"
                    : "border-surface-border text-ink-muted"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

/* ──────────────────── Fler filter (sheet) ─────────────────────── */

function MoreSheet({
  open,
  searchParams,
  categories,
  retailers,
  languages,
  total,
  onClose,
  onApply,
}: {
  open: boolean;
  searchParams: ExploreSearchParams;
  categories: FilterOption[];
  retailers: FilterOption[];
  languages: FilterOption[];
  total: number;
  onClose: () => void;
  onApply: (patch: Partial<Record<keyof ExploreSearchParams, string | undefined>>) => void;
}) {
  const t = useTranslations("Products");
  const [kategori, setKategori] = useState<string[]>([]);
  const [butik, setButik] = useState<string[]>([]);
  const [sprak, setSprak] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setKategori(csvList(searchParams.kategori));
      setButik(csvList(searchParams.butik));
      setSprak(csvList(searchParams.sprak));
    }
  }, [open, searchParams.kategori, searchParams.butik, searchParams.sprak]);

  /**
   * "Alla sealed" — en genväg, inte en kategori.
   *
   * Sealed är åtta separata kategorier (ETB, Booster Box, Tin, Blister …) och den
   * som vill se "allt utom lösa kort" fick trycka i dem en och en (ägaren
   * 2026-08-06). Chippet väljer hela knippet på ett tryck.
   * ⛔ Ingen ny kategori i databasen och ingen ny URL-parameter: det expanderar
   * till samma `kategori`-lista som om man kryssat i dem för hand, så delade
   * länkar och bakåtknappen fungerar precis som förut.
   */
  const sealedValues = categories.map((c) => c.value).filter(isSealedCategory);
  const sealedActive =
    sealedValues.length > 0 &&
    kategori.length === sealedValues.length &&
    sealedValues.every((v) => kategori.includes(v));

  const groups: {
    label: string;
    values: string[];
    set: (updater: (prev: string[]) => string[]) => void;
    all: string;
    options: FilterOption[];
    /** Extra chip före de enskilda värdena (bara kategorigruppen har ett). */
    bulk?: { label: string; active: boolean; onClick: () => void };
  }[] = [
    // Språk överst (ägarbeslut 2026-09-06): tre chips som annars låg under
    // ~45 butiker och krävde en lång scroll för det vanligaste bytet (EN/JP).
    { label: t("language"), values: sprak, set: setSprak, all: t("allLanguages"), options: languages },
    {
      label: t("category"),
      values: kategori,
      set: setKategori,
      all: t("allCategories"),
      options: categories,
      bulk: {
        label: t("allSealed"),
        active: sealedActive,
        // Andra trycket nollar gruppen — annars vore chippet en enkelriktad
        // väg och man fick avmarkera åtta kategorier för hand för att ångra.
        onClick: () => setKategori(() => (sealedActive ? [] : sealedValues)),
      },
    },
    { label: t("store"), values: butik, set: setButik, all: t("allStores"), options: retailers },
  ];

  const anySelected = kategori.length + butik.length + sprak.length > 0;
  /** Tom lista = "alla" → parametern utelämnas helt ur URL:en. */
  const join = (list: string[]) => (list.length > 0 ? list.join(",") : undefined);

  // Knappen räknar det man PRECIS kryssat i, inte det som redan är applicerat.
  const pendingCount = usePendingCount(
    open,
    { ...searchParams, kategori: join(kategori), butik: join(butik), sprak: join(sprak) },
    total
  );

  return (
    <Sheet
      open={open}
      title={t("moreFilters")}
      onClose={onClose}
      onClear={
        anySelected
          ? () => onApply({ kategori: undefined, butik: undefined, sprak: undefined })
          : undefined
      }
      cta={t("resultCount", { count: pendingCount })}
      onCta={() =>
        onApply({ kategori: join(kategori), butik: join(butik), sprak: join(sprak) })
      }
    >
      <div className="space-y-5 pb-2">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {g.label}
            </p>
            {/* FLERVAL: varje värde slås av och på för sig, och "Alla …" är inte ett
                värde utan nollställningen av gruppen (aktiv när inget är valt). */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={g.values.length === 0}
                onClick={() => g.set(() => [])}
                className={cn(
                  "rounded-full border px-3 py-2 text-[12.5px] font-semibold leading-none transition-colors",
                  g.values.length === 0
                    ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
                    : "border-surface-border text-ink-muted"
                )}
              >
                {g.all}
              </button>
              {g.bulk && (
                <button
                  type="button"
                  aria-pressed={g.bulk.active}
                  onClick={g.bulk.onClick}
                  className={cn(
                    "rounded-full border px-3 py-2 text-[12.5px] font-semibold leading-none transition-colors",
                    g.bulk.active
                      ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
                      : "border-surface-border text-ink-muted"
                  )}
                >
                  {g.bulk.label}
                </button>
              )}
              {g.options.map((o) => {
                const active = g.values.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      g.set((prev) =>
                        prev.includes(o.value)
                          ? prev.filter((v) => v !== o.value)
                          : [...prev, o.value]
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-semibold leading-none transition-colors",
                      active
                        ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
                        : "border-surface-border text-ink-muted"
                    )}
                  >
                    {active && <IconCheck size={12} strokeWidth={3} className="shrink-0" />}
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── Övrigt ─────────────────────────── */

/** Speglar aktiva filter som dolda fält så sökfältets GET-submit behåller dem. */
function HiddenFilters({ searchParams }: { searchParams: ExploreSearchParams }) {
  const keys: (keyof ExploreSearchParams)[] = [
    "kategori",
    "set",
    "butik",
    "minPris",
    "maxPris",
    "lager",
    "sprak",
    "sortera",
  ];
  return (
    <>
      {keys.map((k) =>
        searchParams[k] ? <input key={k} type="hidden" name={k} value={searchParams[k]} /> : null
      )}
    </>
  );
}

/** Ett enda språk i URL:en ("EN"/"JP") — annars null (= alla). */
function langOf(value: string | undefined): string | null {
  const list = csvList(value);
  return list.length === 1 ? list[0] : null;
}

/** "a,b" → ["a","b"]. Tom/saknad → []. */
function csvList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

/** URL-värde → kronor. Saknat/ogiltigt → null (= inget filter / inget tak). */
function parseKr(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Inmatat fältvärde → kronor. Tomt fält = null (inget värde), aldrig 0 — annars
 * hade en raderad siffra blivit ett "från 0 kr"-filter mitt i inmatningen.
 * Taket är BARA en sanity-gräns; man får skriva in större belopp än reglagets.
 */
const PRICE_INPUT_MAX = 10_000_000;
function parseKrInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(PRICE_INPUT_MAX, Math.round(n));
}
