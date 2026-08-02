"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { countQuery, type CountSelection } from "@/lib/explore-count-query";
import { SearchAutocomplete } from "@/components/features/search-autocomplete";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconCheck, IconFilter, IconSearch, IconX } from "@/components/ui/icons";

export interface FilterSet {
  id: string;
  name: string;
  logoUrl: string | null;
  series: string;
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

/**
 * Typografin för träffantalet — delad mellan den synliga plattan och den osynliga
 * spacern sist i chip-raden. DE MÅSTE VARA IDENTISKA: spacern är det enda som ger
 * raden räckvidd nog att dra fram sista chipet under plattan, och mäter den fel
 * (annan fontstorlek, annan padding) är felet exakt lika osynligt som spacern.
 */
const COUNT_TEXT_CLASS = "shrink-0 whitespace-nowrap pl-1 pr-2.5 text-[11.5px] font-medium tabular-nums";
/** Uttoningens bredd — chipet ska vara HELT fritt, inte halvt under gradienten. */
const COUNT_FADE_CLASS = "w-8 shrink-0";

type SheetKind = "sort" | "set" | "price" | "more";

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
 * Utforska-filtren på mobil: en chip-rad under sökfältet där varje chip öppnar en
 * bottensheet, och sorteringen bor i sökfältets högerkant.
 *
 * Filtren lever i URL:en (samma parametrar som desktop-sidofältet skickar), så en
 * delad länk bär hela vyn och serverns `total` alltid stämmer med det som visas.
 * Chip-klick navigerar; sökfältet är kvar i ett vanligt GET-<form> så Enter
 * fungerar utan JS — de dolda fälten nedan bär då med aktiva filter.
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

  const activeSet = sets.find((s) => s.id === searchParams.set) ?? null;
  const inStock = searchParams.lager === "1";

  const minKr = parseKr(searchParams.minPris) ?? 0;
  const maxKr: MaxKr = parseKr(searchParams.maxPris);
  const priceActive = minKr > 0 || maxKr !== null;

  // Flerval → chipet räknar VALDA VÄRDEN, inte hur många grupper som är i bruk.
  const moreCount =
    csvList(searchParams.kategori).length +
    csvList(searchParams.butik).length +
    csvList(searchParams.sprak).length;

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

  /**
   * Träffantalet skrivs på TVÅ ställen med SAMMA text och SAMMA typografi: en
   * synlig platta ovanpå högerkanten, och en osynlig kopia sist i scroll-flödet.
   * Kopian är hela poängen — se kommentaren vid raden nedan — och därför bor
   * strängen och klasserna i var sin konstant: går de isär mäter spacern fel och
   * buggen är tillbaka utan att något syns i koden.
   */
  const countLabel = t("resultCount", { count: total });

  const priceLabel = !priceActive
    ? t("priceShort")
    : maxKr === null
      ? `${minKr.toLocaleString("sv-SE")}+ kr`
      : minKr > 0
        ? `${minKr.toLocaleString("sv-SE")}–${maxKr.toLocaleString("sv-SE")} kr`
        : `≤ ${krLabel(maxKr)}`;

  return (
    <div className="space-y-3">
      {/* Dolda fält: Enter i sökfältet skickar formuläret — utan dem tappas
          aktiva filter vid varje sökning. */}
      <HiddenFilters searchParams={searchParams} />

      <SearchAutocomplete
        name="q"
        defaultValue={searchParams.q ?? ""}
        placeholder={t("mobileSearchPlaceholder")}
        className="gap-2 rounded-xl border border-surface-border bg-surface px-3 transition-colors focus-within:border-holo-cyan/60"
        inputClassName="py-3 placeholder:text-ink-faint"
        leading={<IconSearch size={18} className="shrink-0 text-ink-muted" />}
        trailing={
          <button
            type="button"
            onClick={() => setSheet("sort")}
            aria-label={t("sortBy")}
            className="-mr-1.5 flex h-11 shrink-0 items-center justify-center px-1.5"
          >
            {/* Bara ikonen — ingen platta bakom. Den grå fyllningen läste som en
                egen knapp inuti sökfältet och konkurrerade med förstoringsglaset
                till vänster, som också står naket. Aktivt läge (en annan sortering
                än standard) syns på FÄRGEN, som chipen i raden under. */}
            <span
              className={cn(
                "grid h-[30px] w-[30px] place-items-center transition-colors",
                sortActive ? "text-holo-cyan" : "text-ink"
              )}
            >
              <IconFilter size={18} />
            </span>
          </button>
        }
      />

      {/* Raden går KANT TILL KANT (-mx-2.5 mot sidans px-2.5): förut delade den
          bredden med träffantalet och det gick bara att greppa ~250px mitt på
          skärmen. Antalet ligger nu ovanpå högerkanten på en uttonad svart platta,
          så chipen glider in under det i stället för att trängas med det.
          `touch-action: pan-x pan-y` — raden tar det VÅGRÄTA draget, sidan får det
          LODRÄTA. Enbart `pan-x` gjorde raden till en död zon för sidscroll.
          (Den egentliga orsaken till att svepen inte kändes igen låg utanför den
          här komponenten: studsvakten i pwa-register.tsx avbröt varje gest som
          drev nedåt högst upp på sidan. Se kommentaren där.)

          PLATSEN UNDER PLATTAN MÅSTE FINNAS I FLÖDET, INTE SOM PADDING: raden
          går bara att dra så långt som innehållet sticker ut, och med ett kort
          setnamn ("Pitch Black") är hela chip-raden nätt och jämnt bredare än
          skärmen. Räckvidden blev då mindre än plattan är bred → sista chipet
          ("Fler") gick ALDRIG att dra fram under siffran, men gick att trycka på
          eftersom plattan är pointer-events-none. Ett gissat `pr-[7.5rem]`
          räckte inte, och WebKit räknar dessutom inte alltid med slut-padding i
          en scroll-containers bredd. Spacern nedan är i stället en OSYNLIG KOPIA
          av plattan (`invisible` = tar plats, syns inte): den mäter alltid exakt
          lika mycket som det som täcker, oavsett om det står "8 produkter" eller
          "22 457 products". Räckvidden räcker då per konstruktion — och ryms allt
          utan scroll hamnar sista chipet till vänster om spacern, alltså heller
          aldrig under siffran. */}
      <div className="relative -mx-2.5">
        <div
          className="flex items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1.5 pl-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ touchAction: "pan-x pan-y" }}
        >
          <Chip
            active={!!activeSet}
            label={activeSet?.name ?? t("set")}
            onOpen={() => setSheet("set")}
            onClear={activeSet ? () => pushParams({ set: undefined }) : undefined}
            clearAriaLabel={t("clearSet")}
            leading={
              activeSet?.logoUrl ? (
                <SafeImage
                  src={activeSet.logoUrl}
                  alt=""
                  className="h-3.5 w-[26px] shrink-0 object-contain"
                  fallback={<></>}
                />
              ) : undefined
            }
          />
          <Chip
            active={priceActive}
            label={priceLabel}
            onOpen={() => setSheet("price")}
            onClear={
              priceActive
                ? () => pushParams({ minPris: undefined, maxPris: undefined })
                : undefined
            }
            clearAriaLabel={t("clearPrice")}
          />
          {/* Lagerfiltret är PÅ eller AV — inget val att plocka bort ur. Därför
              inget kryss: ett tryck slår om det, precis som det tändes. */}
          <Chip
            active={inStock}
            label={t("inStockShort")}
            onOpen={() => pushParams({ lager: inStock ? undefined : "1" })}
            clearAriaLabel={t("clearInStock")}
            caret={false}
            pressed={inStock}
          />
          {/* Kategori/butik/språk finns kvar — de ryms bara inte som egna chips. */}
          <Chip
            active={moreCount > 0}
            label={moreCount > 0 ? `${t("moreFilters")} · ${moreCount}` : t("moreFilters")}
            onOpen={() => setSheet("more")}
            onClear={
              moreCount > 0
                ? () => pushParams({ kategori: undefined, butik: undefined, sprak: undefined })
                : undefined
            }
            clearAriaLabel={t("clearMoreFilters")}
          />
          {/* Spacern (aria-hidden: skärmläsare hör siffran en gång, från plattan). */}
          <span aria-hidden className="invisible flex shrink-0 items-center">
            <span className={COUNT_FADE_CLASS} />
            <span className={COUNT_TEXT_CLASS}>{countLabel}</span>
          </span>
        </div>
        {/* Uttoning + solid platta som två egna ytor i stället för en gradient med
            färgstopp: siffran måste ligga på HELT svart, annars läste chipet under
            rakt igenom den och de två texterna gick i varandra. */}
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center">
          <span
            aria-hidden
            className={cn(COUNT_FADE_CLASS, "h-full bg-gradient-to-r from-transparent to-surface")}
          />
          <span
            aria-live="polite"
            className={cn(COUNT_TEXT_CLASS, "flex h-full items-center bg-surface text-ink-faint")}
          >
            {countLabel}
          </span>
        </span>
      </div>

      <Sheet
        open={sheet === "sort"}
        title={t("sortBy")}
        onClose={() => setSheet(null)}
        onClear={sortActive ? () => pushParams({ sortera: undefined }) : undefined}
        cta={t("resultCount", { count: total })}
      >
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
      </Sheet>

      <SetSheet
        open={sheet === "set"}
        sets={sets}
        activeSetId={searchParams.set}
        total={total}
        onClose={() => setSheet(null)}
        onPick={(id) => {
          pushParams({ set: id });
          setSheet(null);
        }}
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

/* ───────────────────────────── Chip ───────────────────────────── */

function Chip({
  active,
  label,
  onOpen,
  onClear,
  clearAriaLabel,
  leading,
  caret = true,
  pressed,
}: {
  active: boolean;
  label: string;
  onOpen: () => void;
  onClear?: () => void;
  clearAriaLabel: string;
  leading?: ReactNode;
  caret?: boolean;
  /** Sätt för av/på-chips — då exponeras chipet som en toggle för skärmläsare. */
  pressed?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border transition-colors",
        active
          ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
          : "border-surface-border bg-surface text-ink",
        onClear ? "pr-2" : "pr-0"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={pressed}
        className="inline-flex max-w-[11rem] items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold leading-none"
      >
        {leading}
        <span className="truncate">{label}</span>
        {caret && !active && <span className="opacity-60">▾</span>}
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearAriaLabel}
          // Träffytan får INTE vara högre än radens padding tål: en 44px-knapp i ett
          // ~30px chip gjorde scrollern lodrätt överfylld, och då gick chip-raden att
          // dra upp och ner. 36px ryms innanför py-1.5 → ingen lodrät overflow alls.
          className="-ml-3 -mr-1 box-border flex h-9 w-9 shrink-0 items-center justify-center p-2.5"
        >
          <span className="grid h-4 w-4 place-items-center rounded-full bg-holo-cyan/20 text-holo-cyan">
            <IconX size={10} strokeWidth={3} />
          </span>
        </button>
      )}
    </span>
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
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  // Tangentbordshöjd → sheeten lyfts ovanför tangentbordet i stället för att
  // hamna bakom det (prisfältens sifferknappsats täckte hela panelen). Samma
  // mätning som ui/modal.tsx: native-appen kör Keyboard resize:none, så varken
  // WKWebView:en eller visualViewport krymper där — Capacitor-bryggan är enda
  // pålitliga signalen. På webb/PWA finns ingen brygga → visualViewport.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!open) return;
    const cleanups: (() => void)[] = [];
    const kb = (globalThis as { Capacitor?: { Plugins?: { Keyboard?: any } } }).Capacitor
      ?.Plugins?.Keyboard;
    if (kb?.addListener) {
      const add = (ev: string, fn: (i: any) => void) => {
        const p = kb.addListener(ev, fn);
        Promise.resolve(p)
          .then((h: any) => cleanups.push(() => h?.remove?.()))
          .catch(() => {});
      };
      add("keyboardWillShow", (i: { keyboardHeight?: number }) => setKbHeight(i?.keyboardHeight ?? 0));
      add("keyboardWillHide", () => setKbHeight(0));
    } else if (typeof window !== "undefined" && window.visualViewport) {
      const vp = window.visualViewport;
      const update = () => setKbHeight(Math.max(0, window.innerHeight - vp.height - vp.offsetTop));
      update();
      vp.addEventListener("resize", update);
      vp.addEventListener("scroll", update);
      cleanups.push(() => {
        vp.removeEventListener("resize", update);
        vp.removeEventListener("scroll", update);
      });
    }
    return () => {
      cleanups.forEach((c) => c());
      setKbHeight(0);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      // Overlayn slutar där tangentbordet börjar → panelen (justify-end) landar
      // ovanpå det, och max-h räknas mot den mindre ytan så innehållet scrollar.
      className="fixed inset-x-0 top-0 z-50 flex flex-col justify-end bg-black/55 backdrop-blur-[3px]"
      style={{ bottom: kbHeight }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("closeSheet")}
        className="absolute inset-0 cursor-default"
      />
      <div
        ref={panelRef}
        className="relative flex max-h-[84%] flex-col rounded-t-[20px] bg-surface pt-2 shadow-[0_-1px_0_0_rgba(255,255,255,0.06)] animate-slide-up"
      >
        <span aria-hidden="true" className="mx-auto mb-3 mt-1.5 h-1 w-9 rounded-full bg-surface-border" />
        <div className="flex items-center justify-between px-[18px] pb-3">
          <p className="text-base font-bold tracking-[-0.01em] text-ink">{title}</p>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-ink-faint transition-colors hover:text-ink"
            >
              {t("clear")}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[18px]">{children}</div>
        <div
          className={cn(
            "px-[18px] pt-3.5",
            // Tangentbord uppe: overlayn slutar redan ovanför det → ingen extra
            // säkerhetsmarginal (den hade lyft knappen 30px för högt).
            kbHeight > 0 ? "pb-3.5" : "pb-[max(1.875rem,env(safe-area-inset-bottom))]"
          )}
        >
          <button
            type="button"
            onClick={onCta ?? onClose}
            className="w-full rounded-[10px] bg-holo-cyan px-4 py-3.5 text-sm font-bold tabular-nums text-surface transition-opacity active:opacity-90"
          >
            {t("showResults", { results: cta })}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── Set-sheet ─────────────────────────── */

function SetSheet({
  open,
  sets,
  activeSetId,
  total,
  onClose,
  onPick,
}: {
  open: boolean;
  sets: FilterSet[];
  activeSetId?: string;
  total: number;
  onClose: () => void;
  onPick: (id: string | undefined) => void;
}) {
  const t = useTranslations("Products");
  // EN rubrik per SERIE — inte en per löpande grupp. Listan kommer sorterad på
  // releaseDate (nyast först), och promo-/POP-set ligger inklämda mitt bland
  // huvudserierna (SWSH Black Star Promos 2022-08-03 hamnar mellan två Sword &
  // Shield-set). Den gamla logiken bröt en ny rubrik vid varje sådant hopp:
  // 65 rubriker för 17 serier, och "Sword & Shield" dök upp nio gånger — det såg
  // ut som om seten låg i fel serie. Map:en slår ihop dem i stället.
  // Serieordningen = där seriens NYASTE set ligger (först sedd), och inuti varje
  // serie står nyast först — samma ordning som /sets-sidan bygger.
  const grouped = useMemo(() => {
    const bySeries = new Map<string, FilterSet[]>();
    for (const s of sets) {
      const list = bySeries.get(s.series);
      if (list) list.push(s);
      else bySeries.set(s.series, [s]);
    }
    return [...bySeries].map(([series, items]) => ({ series, items }));
  }, [sets]);

  return (
    <Sheet
      open={open}
      title={t("chooseSet")}
      onClose={onClose}
      onClear={activeSetId ? () => onPick(undefined) : undefined}
      cta={t("resultCount", { count: total })}
    >
      <div className="space-y-5 pb-2">
        {grouped.map((group) => (
          <div key={group.series}>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {group.series}
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              {group.items.map((s) => {
                const selected = s.id === activeSetId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPick(selected ? undefined : s.id)}
                    className="flex flex-col gap-1.5 text-center"
                  >
                    <span
                      className={cn(
                        "relative flex h-16 items-center justify-center rounded-[10px] border bg-surface px-2 transition-all",
                        selected
                          ? "border-holo-cyan shadow-glow"
                          : "border-surface-border"
                      )}
                    >
                      {/* Saknad logotyp → samma neutrala kort-ikon som "Nyss släppt"
                          använder. Namnet står redan i bildtexten under brickan;
                          att upprepa det inuti rutan sa samma sak två gånger. */}
                      <SafeImage
                        src={s.logoUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        fallback={
                          <IconCards
                            size={22}
                            className={selected ? "text-holo-cyan" : "text-ink-faint"}
                          />
                        }
                      />
                      {selected && (
                        <span className="absolute right-1 top-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-holo-cyan text-surface">
                          <IconCheck size={10} strokeWidth={3.4} />
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 text-[11px] font-medium leading-snug text-ink">
                      {s.name}
                    </span>
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

  const groups: {
    label: string;
    values: string[];
    set: (updater: (prev: string[]) => string[]) => void;
    all: string;
    options: FilterOption[];
  }[] = [
    { label: t("category"), values: kategori, set: setKategori, all: t("allCategories"), options: categories },
    { label: t("store"), values: butik, set: setButik, all: t("allStores"), options: retailers },
    { label: t("language"), values: sprak, set: setSprak, all: t("allLanguages"), options: languages },
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
