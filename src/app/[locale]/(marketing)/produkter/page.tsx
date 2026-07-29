import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cachedRead } from "@/lib/cache";
import { prisma } from "@/lib/db";
import {
  getExploreFeed,
  HIDDEN_CATEGORIES,
  NON_STORE_RETAILER_NAMES,
  type ProductSort,
  type SearchProductsParams,
} from "@/services/products";
import type { CardLanguage, ProductCategory } from "@prisma/client";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ExploreFeed } from "@/components/features/explore-feed";
import { ExploreFilterBar } from "@/components/features/explore-filter-bar";
import { SearchAutocomplete } from "@/components/features/search-autocomplete";
import { Input, Select, Label, Checkbox } from "@/components/ui/input";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch, IconScan, IconCards } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Products" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

const PAGE_SIZE = 24;

// Filterfacetterna (set-/butikslistor) ändras ~aldrig men sidan är force-dynamic
// (searchParams) → utan cache kördes de tre frågorna på VARJE sidvisning/crawl-träff
// (~900k CardSet-skanningar på Neon). 1h TTL är osynlig för användare.
// logoUrl + series driver mobilens set-sheet (logotypbrickor grupperade på serie).
// Samma cachade fråga som desktop-sidofältets <select> — inga extra Neon-läsningar.
const getFilterSets = cachedRead(
  () =>
    prisma.cardSet.findMany({
      select: { id: true, name: true, logoUrl: true, series: true },
      // nulls: "last" — Postgres lägger NULL FÖRST vid DESC, så ett set utan
      // releaseDate (t.ex. ett promo-set vi skapat innan pokemontcg.io har det)
      // hamnade överst i filtret som om det vore det allra nyaste.
      orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
    }),
  "produkterFilterSets",
  3600
);
const getFilterRetailers = cachedRead(
  () =>
    prisma.retailer.findMany({
      where: { isActive: true, name: { notIn: NON_STORE_RETAILER_NAMES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  "produkterFilterRetailers",
  3600
);
const getRecentSets = cachedRead(
  () =>
    prisma.cardSet.findMany({
      where: { releaseDate: { not: null } },
      select: { id: true, name: true, logoUrl: true, totalCards: true },
      orderBy: { releaseDate: "desc" },
      take: 12,
    }),
  "produkterRecentSets",
  3600
);

// value = URL-parameter (stabil), key = översättningsnyckel (Products.sort.*).
const SORT_OPTIONS: { value: string; key: string; sort: ProductSort }[] = [
  { value: "popular", key: "popular", sort: "popular" },
  { value: "lagsta-pris", key: "price_asc", sort: "price_asc" },
  { value: "hogsta-pris", key: "price_desc", sort: "price_desc" },
  { value: "prisfall", key: "biggest_drop", sort: "biggest_drop" },
  { value: "restock", key: "recently_restocked", sort: "recently_restocked" },
  { value: "bevakad", key: "most_watched", sort: "most_watched" },
  { value: "trend", key: "trending", sort: "trending" },
  { value: "kortnummer", key: "card_number_asc", sort: "card_number_asc" },
  { value: "kortnummer-fallande", key: "card_number_desc", sort: "card_number_desc" },
  // "Fynd" borttaget ur filtret 2026-07-21 (ägarbeslut). Sorteringen finns kvar i
  // feed-API:t och services/products, så filtret kan tas tillbaka med en rad här.
];

// Giltiga språknycklar (för validering av ?sprak); visning via Language-namespace.
// BARA katalogens språk (EN+JP). Förut gick ?sprak=OTHER att skicka in → man kunde
// bläddra fram just de blockade produkter som inte ska finnas i katalogen alls.
const LANGUAGE_KEYS: CardLanguage[] = ["EN", "JP"];

/** Språk som visas i katalogfiltret (övriga gömda tills vidare, 2026-06-14). */
const BROWSE_LANGUAGES: CardLanguage[] = ["EN", "JP"];

interface CatalogSearchParams {
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

function parseKr(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const kr = Number(value.replace(",", "."));
  if (!Number.isFinite(kr) || kr < 0) return undefined;
  return Math.round(kr * 100); // kr → öre
}

/** "a,b,c" → ["a","b","c"]. Tom lista → undefined (= inget filter). */
function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value.split(",").map((v) => v.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function buildParams(sp: CatalogSearchParams): SearchProductsParams {
  // Kategori/butik/språk är FLERVAL (kommaseparerat i URL:en). Okända värden
  // kastas tyst — en gammal länk med en borttagen butik ska visa katalogen, inte
  // ett tomt resultat.
  const category = csv(sp.kategori)?.filter(
    (v): v is ProductCategory => v in CATEGORY_LABELS
  );
  const language = csv(sp.sprak)?.filter((v): v is CardLanguage =>
    LANGUAGE_KEYS.includes(v as CardLanguage)
  );
  const sort =
    SORT_OPTIONS.find((o) => o.value === sp.sortera)?.sort ?? "popular";
  const page = Math.max(1, Number(sp.sida) || 1);

  return {
    query: sp.q?.trim() || undefined,
    category: category?.length ? category : undefined,
    setId: sp.set || undefined,
    retailerId: csv(sp.butik),
    minPrice: parseKr(sp.minPris),
    maxPrice: parseKr(sp.maxPris),
    stockStatus: sp.lager === "1" ? "IN_STOCK" : undefined,
    language: language?.length ? language : undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Nyckel som ändras så fort ett filter i URL:en ändras. Sätts på formulären så att
 * React MONTERAR OM dem vid klient-navigering — annars behåller de okontrollerade
 * <select>/<input>-noderna sina gamla DOM-värden (defaultValue skriver bara vid
 * montering). Utan detta visade sidofältet fel filter efter ett klick på ett sets
 * namn i katalogkortet, och nästa "Filtrera" skickade in de gamla värdena igen.
 * Vanlig formulär-submit är en full sidladdning → nyckeln är no-op där.
 */
function filterStateKey(sp: CatalogSearchParams): string {
  return [sp.q, sp.kategori, sp.set, sp.butik, sp.minPris, sp.maxPris, sp.lager, sp.sprak, sp.sortera]
    .map((v) => v ?? "")
    .join("|");
}

/** Serialiserar filtren till feed-API:ts query (engelska parametrar). */
function buildFeedQuery(p: SearchProductsParams): string {
  const s = new URLSearchParams();
  // Flervalsfälten skickas kommaseparerat — feed-routens schema delar upp dem igen.
  const join = (v: string | string[] | undefined) =>
    Array.isArray(v) ? (v.length > 0 ? v.join(",") : undefined) : v;
  if (p.query) s.set("query", p.query);
  const category = join(p.category);
  if (category) s.set("category", category);
  if (p.setId) s.set("setId", p.setId);
  const retailerId = join(p.retailerId);
  if (retailerId) s.set("retailerId", retailerId);
  if (p.minPrice !== undefined) s.set("minPrice", String(p.minPrice));
  if (p.maxPrice !== undefined) s.set("maxPrice", String(p.maxPrice));
  if (p.stockStatus) s.set("stockStatus", p.stockStatus);
  const language = join(p.language);
  if (language) s.set("language", language);
  s.set("sort", p.sort ?? "popular");
  return s.toString();
}

/** Sök-fält (q) med skanna-genväg — desktop-varianten. */
function SearchField({ defaultQuery }: { defaultQuery?: string }) {
  const t = useTranslations("Products");
  return (
    <div>
      <Label htmlFor="q">{t("search")}</Label>
      <div className="flex items-center gap-2">
        <SearchAutocomplete
          id="q"
          defaultValue={defaultQuery ?? ""}
          placeholder={t("searchPlaceholder")}
          className="h-10 flex-1 rounded-lg border border-surface-border bg-surface-raised px-3 transition-colors focus-within:border-holo-cyan focus-within:ring-2 focus-within:ring-holo-cyan/30"
          dropdownClassName="left-0 w-[24rem] max-w-[calc(100vw-2rem)]"
        />
        <Link
          href="/skanna"
          aria-label={t("scanAria")}
          title={t("scanTitle")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-border bg-surface-overlay text-ink-muted transition-colors hover:border-holo-cyan/60 hover:text-holo-cyan focus-visible:border-holo-cyan/60 focus-visible:text-holo-cyan"
        >
          <IconScan size={20} />
        </Link>
      </div>
    </div>
  );
}

/**
 * Filterfälten (kategori … sortering) utan sök och utan eget <form>. Återanvänds av
 * desktop-sidofältet och mobilens hopfällbara panel. `idPrefix` håller fält-id unika
 * mellan de två kopiorna (annars dubblett-id i DOM:en).
 */
function CatalogFilterFields({
  searchParams,
  sets,
  retailers,
  idPrefix,
}: {
  searchParams: CatalogSearchParams;
  sets: { id: string; name: string }[];
  retailers: { id: string; name: string }[];
  idPrefix: string;
}) {
  const t = useTranslations("Products");
  const tCat = useTranslations("Category");
  const tLang = useTranslations("Language");
  // Mobilens "Fler filter" är FLERVAL och skriver kommalistor i URL:en. Desktop-
  // sidofältet är enval — visa första värdet i stället för att stå tomt (ett tomt
  // <select> hade sett ut som "inget filter" fast katalogen var filtrerad).
  const first = (v: string | undefined) => (v ? v.split(",")[0] : "");
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}kategori`}>{t("category")}</Label>
        <Select id={`${idPrefix}kategori`} name="kategori" defaultValue={first(searchParams.kategori)}>
          <option value="">{t("allCategories")}</option>
          {Object.keys(CATEGORY_LABELS)
            .filter((value) => !HIDDEN_CATEGORIES.includes(value as ProductCategory))
            .map((value) => (
              <option key={value} value={value}>
                {tCat(value)}
              </option>
            ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}set`}>{t("set")}</Label>
        <Select id={`${idPrefix}set`} name="set" defaultValue={searchParams.set ?? ""}>
          <option value="">{t("allSets")}</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}butik`}>{t("store")}</Label>
        <Select id={`${idPrefix}butik`} name="butik" defaultValue={first(searchParams.butik)}>
          <option value="">{t("allStores")}</option>
          {retailers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>{t("price")}</Label>
        <div className="flex items-center gap-2">
          <Input
            name="minPris"
            type="number"
            min={0}
            placeholder={t("min")}
            aria-label={t("minAria")}
            defaultValue={searchParams.minPris ?? ""}
          />
          <span className="text-ink-faint">–</span>
          <Input
            name="maxPris"
            type="number"
            min={0}
            placeholder={t("max")}
            aria-label={t("maxAria")}
            defaultValue={searchParams.maxPris ?? ""}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}sprak`}>{t("language")}</Label>
        <Select id={`${idPrefix}sprak`} name="sprak" defaultValue={first(searchParams.sprak)}>
          <option value="">{t("allLanguages")}</option>
          {BROWSE_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {tLang(value)}
            </option>
          ))}
        </Select>
      </div>
      <Checkbox
        id={`${idPrefix}lager`}
        name="lager"
        value="1"
        label={t("inStockOnly")}
        defaultChecked={searchParams.lager === "1"}
      />
      <div>
        <Label htmlFor={`${idPrefix}sortera`}>{t("sortBy")}</Label>
        <Select id={`${idPrefix}sortera`} name="sortera" defaultValue={searchParams.sortera ?? "popular"}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`sort.${o.key}`)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" className="w-full">
        {t("filter")}
      </Button>
      <Link
        href="/produkter"
        className="block text-center text-sm text-ink-muted hover:text-ink"
      >
        {t("clearFilters")}
      </Link>
    </>
  );
}

export default async function ProductsPage({
  params: routeParams,
  searchParams,
}: {
  params: { locale: string };
  searchParams: CatalogSearchParams;
}) {
  setRequestLocale(routeParams.locale);
  const t = await getTranslations("Products");
  const tCat = await getTranslations("Category");
  const tLang = await getTranslations("Language");
  const params = buildParams(searchParams);
  const [result, sets, retailers, recentSets] = await Promise.all([
    getExploreFeed(params, 0, PAGE_SIZE),
    getFilterSets(),
    getFilterRetailers(),
    // "Just Dropped" — senast släppta set.
    getRecentSets(),
  ]);
  const feedQuery = buildFeedQuery(params);
  const filterKey = filterStateKey(searchParams);

  // Färdigöversatta alternativ till mobilens chip-sheets (klientkomponenten ska
  // inte behöva känna till Category-/Language-namespacen).
  const categoryOptions = Object.keys(CATEGORY_LABELS)
    .filter((value) => !HIDDEN_CATEGORIES.includes(value as ProductCategory))
    .map((value) => ({ value, label: tCat(value) }));
  const languageOptions = BROWSE_LANGUAGES.map((value) => ({
    value,
    label: tLang(value),
  }));
  const sortOptionList = SORT_OPTIONS.map((o) => ({
    value: o.value,
    label: t(`sort.${o.key}`),
  }));

  const feed = result.items.length === 0 ? (
      <EmptyState
        icon={<IconSearch size={32} />}
        title={t("noMatchTitle")}
        description={t("noMatchDesc")}
        action={
          <LinkButton href="/produkter" variant="secondary" size="sm">
            {t("clearFilters")}
          </LinkButton>
        }
      />
    ) : (
      // key={feedQuery} → komponenten remountas (nollställer scroll-state) när filter ändras.
      <ExploreFeed
        key={feedQuery}
        initialItems={result.items}
        initialHasMore={result.hasMore}
        feedQuery={feedQuery}
        pageSize={PAGE_SIZE}
      />
    );

  const justDropped = recentSets.length > 0 && (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-xl font-bold text-ink">{t("justDropped")}</h2>
        <Link href="/sets" className="text-xs font-semibold text-holo-cyan hover:underline">
          {t("showAll")}
        </Link>
      </div>
      <div className="-mx-2.5 flex gap-3 overflow-x-auto px-2.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recentSets.map((s) => (
          <Link
            key={s.id}
            href={`/sets/${s.id}`}
            className="card-surface group w-44 shrink-0 overflow-hidden transition-colors hover:border-holo-cyan/40"
          >
            {/* Svart bildbrunn, som produktkorten — grå plattor lyser på svart yta. */}
            <div className="flex h-24 w-full items-center justify-center bg-surface p-4">
              {s.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.logoUrl}
                  alt={s.name}
                  loading="lazy"
                  decoding="async"
                  className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <IconCards size={32} className="text-ink-faint" />
              )}
            </div>
            <div className="p-3">
              <h3 className="truncate text-sm font-semibold text-ink">{s.name}</h3>
              <p className="mt-1 text-xs text-ink-muted">
                {s.totalCards > 0 ? t("setCards", { count: s.totalCards }) : t("setFallback")}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-7xl px-2.5 py-6 sm:px-6 lg:py-10">
      {/* Rubrik — endast desktop (mobilen leder med sökfältet) */}
      <div className="hidden lg:block">
        <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-2 text-ink-muted">
          {t("intro")}
        </p>
      </div>

      {/* ───────── Mobil: app-känsla ───────── */}
      {/* Sökfältet ligger kvar i ett GET-<form> (Enter = full sökning utan JS);
          chip-raden inuti navigerar klient-sida och speglar filtren som dolda fält.
          Träffantalet bor i chip-raden — därav ingen egen rubrikrad här. */}
      <div className="space-y-8 lg:hidden">
        <form key={filterKey} method="GET" action="/produkter">
          <ExploreFilterBar
            searchParams={searchParams}
            sets={sets}
            retailers={retailers.map((r) => ({ value: r.id, label: r.name }))}
            categories={categoryOptions}
            languages={languageOptions}
            sortOptions={sortOptionList}
            total={result.total}
          />
        </form>

        <section>{feed}</section>

        {justDropped}
      </div>

      {/* ───────── Desktop: sidofält + resultat ───────── */}
      <div className="mt-8 hidden gap-8 lg:grid lg:grid-cols-[260px_1fr]">
        <aside>
          <form
            key={filterKey}
            method="GET"
            action="/produkter"
            // z-30: sticky skapar en egen stacking context på z-auto → utan
            // uttryckligt z målades kortgriden (senare i DOM) över sökförslags-
            // dropdownen. Under headerns z-40.
            className="card-surface sticky top-20 z-30 space-y-4 p-5"
          >
            <SearchField defaultQuery={searchParams.q} />
            <CatalogFilterFields
              searchParams={searchParams}
              sets={sets}
              retailers={retailers}
              idPrefix="d-"
            />
          </form>
        </aside>
        <section>
          <p className="mb-4 text-sm text-ink-muted" aria-live="polite">
            {t("resultFound", { count: result.total })}
          </p>
          {feed}
        </section>
      </div>
    </div>
  );
}
