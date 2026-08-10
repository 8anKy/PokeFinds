import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cachedRead } from "@/lib/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getExploreFeed,
  HIDDEN_CATEGORIES,
  NON_STORE_RETAILER_NAMES,
  type ProductSort,
  type SearchProductsParams,
} from "@/services/products";
import {
  getExploreFacets,
  getExploreLastSeen,
  HISTOGRAM_EDGES_KR,
} from "@/services/explore-facets";
import { getTopDrops } from "@/services/market";
import { formatPercent } from "@/lib/format";
import type { CardLanguage, ProductCategory } from "@prisma/client";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ExploreFeed } from "@/components/features/explore-feed";
import { ExploreFilterBar } from "@/components/features/explore-filter-bar";
import { ExploreSearchRow } from "@/components/features/explore-search-row";
import {
  ExploreActiveChips,
  ExploreFilterPanel,
} from "@/components/features/explore-filter-panel";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Products" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/produkter"),
  };
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
      // `language` driver flikarna Engelska/Japanska i set-arket. Japanska set
      // skapas bara när vi FAKTISKT säljer något ur dem (jp-set-label.ts), så
      // listan behöver ingen produktfiltrering — varje japansk bricka leder till
      // träffar. De saknar logotyp (ingen leverantör publicerar japanska
      // setlogotyper) och faller tillbaka på kortikonen, precis som EN-set utan bild.
      select: { id: true, name: true, logoUrl: true, series: true, language: true },
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

// value = URL-parameter (stabil), key = översättningsnyckel (Products.sort.*).
/**
 * ORDNINGEN ÄR GRUPPERAD EFTER AVSIKT, inte historisk (listan hade vuxit fram i den
 * ordning sorteringarna byggts): först relevans, sedan PRIS (de tre som handlar om
 * vad varan kostar, inklusive prisfallet), sedan ORDNING (kortnummer och bokstav —
 * "bläddra som i en pärm"), sist MARKNAD (signaler om vad andra gör). Motsatspar
 * står alltid intill varandra, stigande före fallande.
 *
 * Index 0 är dessutom katalogens standard (`defaultSort` i ExploreFilterBar) → "Bäst
 * matchning" måste ligga först även tekniskt, inte bara visuellt.
 *
 * "Mest populär" (ren engagemangsvolym) är ersatt av "Bäst matchning" 2026-07-29:
 * relevans × kvalitet, plus dina egna bevakningar/samling. Volymen finns kvar som en
 * INGREDIENS i poängen. Gamla länkar med ?sortera=popular funkar (normalizeSort).
 */
const SORT_OPTIONS: { value: string; key: string; sort: ProductSort }[] = [
  // Relevans
  { value: "basta-traff", key: "best_match", sort: "best_match" },
  // Pris
  { value: "lagsta-pris", key: "price_asc", sort: "price_asc" },
  { value: "hogsta-pris", key: "price_desc", sort: "price_desc" },
  { value: "prisfall", key: "biggest_drop", sort: "biggest_drop" },
  // Ordning
  { value: "kortnummer", key: "card_number_asc", sort: "card_number_asc" },
  { value: "kortnummer-fallande", key: "card_number_desc", sort: "card_number_desc" },
  { value: "a-o", key: "title_asc", sort: "title_asc" },
  { value: "o-a", key: "title_desc", sort: "title_desc" },
  // Marknad
  { value: "trend", key: "trending", sort: "trending" },
  { value: "bevakad", key: "most_watched", sort: "most_watched" },
  { value: "restock", key: "recently_restocked", sort: "recently_restocked" },
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
  // Okänt/borttaget värde (t.ex. den gamla ?sortera=popular) → katalogens standard.
  const sort =
    SORT_OPTIONS.find((o) => o.value === sp.sortera)?.sort ?? "best_match";
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
  // userId skickas ALDRIG med i URL:en — feed-routen läser sessionen själv.
  s.set("sort", p.sort ?? "best_match");
  return s.toString();
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
  // Sessionen läses HÄR (sidan är force-dynamic) — inte i marketing-layouten, som
  // måste förbli auth-fri för att resten av katalogen ska kunna ISR-cachas.
  // JWT-sessioner → ingen DB-fråga. Bara "bäst matchning" bryr sig om vem du är.
  const session = await auth();
  const params = { ...buildParams(searchParams), userId: session?.user?.id };
  // Facetter/toppfall/senast-sedd är delade cacher (1h/10 min) — de kostar inga
  // extra Neon-läsningar per sidvisning, bara per TTL-fönster.
  const [result, sets, retailers, facets, lastSeenIso, topDrops] = await Promise.all([
    getExploreFeed(params, 0, PAGE_SIZE),
    getFilterSets(),
    getFilterRetailers(),
    getExploreFacets(),
    getExploreLastSeen(),
    getTopDrops(),
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

  // ── Desktop-sidofältets data: facetantal kopplas på filterlistorna ──
  const categoryCount = new Map(facets.categories.map((c) => [c.value as string, c.count]));
  const panelCategories = categoryOptions
    .map((c) => ({ ...c, count: categoryCount.get(c.value) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const setCount = new Map(facets.sets.map((s) => [s.id, s.count]));
  const panelSets = sets.map((s) => ({
    id: s.id,
    name: s.name,
    language: s.language,
    count: setCount.get(s.id) ?? 0,
  }));
  const retailerCount = new Map(facets.retailers.map((r) => [r.id, r.count]));
  const panelRetailers = retailers
    .map((r) => ({ value: r.id, label: r.name, count: retailerCount.get(r.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);

  // Rubrikradens siffror. "Uppdaterad …" räknas per request (sidan är
  // force-dynamic); källan är en 10-min-cachad MAX(lastSeenAt).
  const nf = new Intl.NumberFormat("sv-SE");
  let updatedLabel = t("updatedNow");
  if (lastSeenIso) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(lastSeenIso).getTime()) / 60_000));
    updatedLabel =
      minutes < 1
        ? t("updatedNow")
        : minutes < 60
          ? t("updatedMinAgo", { count: minutes })
          : t("updatedHoursAgo", { count: Math.floor(minutes / 60) });
  }
  const biggestDrop = topDrops[0]?.changePercent ?? null;

  const currentSort =
    SORT_OPTIONS.find((o) => o.value === searchParams.sortera)?.value ?? SORT_OPTIONS[0].value;
  const hiddenSearchParams = {
    kategori: searchParams.kategori,
    set: searchParams.set,
    butik: searchParams.butik,
    minPris: searchParams.minPris,
    maxPris: searchParams.maxPris,
    lager: searchParams.lager,
    sprak: searchParams.sprak,
    sortera: searchParams.sortera,
  };

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

  // "Nyss släppt"-rälsen (set-logotyper under feeden) är BORTTAGEN 2026-07-29
  // (ägarbeslut): utforska-fliken ska visa produkter, inte set. Setgalleriet finns
  // kvar på /sets. Frågan efter de senaste seten är borttagen med den — inte bara
  // gömd — så den inte fortsätter kosta en Neon-läsning per sidvisning.

  return (
    <div className="mx-auto max-w-7xl px-2.5 py-6 sm:px-6 lg:py-10">
      {/* Rubrikrad — endast desktop (mobilen leder med sökfältet). Till höger:
          live-punkt + "uppdaterad …" och två marknadssiffror ur delade cacher. */}
      <div className="hidden items-end justify-between gap-6 lg:flex">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
          <p className="mt-2 max-w-xl text-ink-muted">{t("intro")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-8 pb-1">
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            <span aria-hidden className="h-2 w-2 animate-pulse-soft rounded-full bg-rise" />
            {updatedLabel}
          </span>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              {t("inStockNow")}
            </p>
            <p className="font-display text-lg font-bold tabular-nums text-ink">
              {nf.format(facets.inStock)}
            </p>
          </div>
          {biggestDrop != null && biggestDrop < 0 && (
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {t("biggestDrop7d")}
              </p>
              <p className="font-display text-lg font-bold tabular-nums text-fall">
                {formatPercent(biggestDrop)}
              </p>
            </div>
          )}
        </div>
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
      </div>

      {/* ───────── Desktop: fullbred sökrad + sidofält + resultat ───────── */}
      <div className="hidden lg:block">
        {/* key={filterKey}: sök-/sorteringsraden bär defaultValue + dolda fält ur
            URL:en och måste MONTERAS OM vid klientnavigering (samma skäl som
            mobilformuläret ovan). relative z-30 i komponenten: under headerns
            z-40, över kortgriden (sökförslags-dropdownen målas annars under). */}
        <div className="mt-6">
          <ExploreSearchRow
            key={filterKey}
            defaultQuery={searchParams.q}
            hiddenParams={hiddenSearchParams}
            sortOptions={sortOptionList}
            currentSort={currentSort}
            defaultSort={SORT_OPTIONS[0].value}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* z-10, UNDER sökradens z-30: sökförslags-dropdownen hänger ner ÖVER
              panelens övre kant och målades annars bakom den (samma stacking-
              fälla som gamla sidofältet, fast åt andra hållet). */}
          <aside className="sticky top-20 z-10 self-start">
            <ExploreFilterPanel
              categories={panelCategories}
              sets={panelSets}
              retailers={panelRetailers}
              languages={languageOptions}
              priceBuckets={facets.priceBuckets}
              edgesKr={HISTOGRAM_EDGES_KR}
              total={result.total}
            />
          </aside>
          {/* scroll-mt: "Visa N produkter"-knappen scrollar hit — landa under
              den sticky headern, inte bakom den. */}
          <section id="explore-results" className="scroll-mt-24">
            <ExploreActiveChips
              categories={panelCategories}
              sets={panelSets}
              retailers={panelRetailers}
              languages={languageOptions}
              total={result.total}
            />
            {feed}
          </section>
        </div>
      </div>
    </div>
  );
}
