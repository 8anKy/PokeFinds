import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
import { Input, Select, Label, Checkbox } from "@/components/ui/input";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch, IconScan, IconCards, IconFilter } from "@/components/ui/icons";

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

// value = URL-parameter (stabil), key = översättningsnyckel (Products.sort.*).
const SORT_OPTIONS: { value: string; key: string; sort: ProductSort }[] = [
  { value: "popular", key: "popular", sort: "popular" },
  { value: "lagsta-pris", key: "price_asc", sort: "price_asc" },
  { value: "hogsta-pris", key: "price_desc", sort: "price_desc" },
  { value: "prisfall", key: "biggest_drop", sort: "biggest_drop" },
  { value: "restock", key: "recently_restocked", sort: "recently_restocked" },
  { value: "bevakad", key: "most_watched", sort: "most_watched" },
  { value: "trend", key: "trending", sort: "trending" },
];

// Giltiga språknycklar (för validering av ?sprak); visning via Language-namespace.
const LANGUAGE_KEYS: CardLanguage[] = ["SV", "EN", "JP", "DE", "FR", "OTHER"];

/** Språk som visas i katalogfiltret (övriga gömda tills vidare, 2026-06-14). */
const BROWSE_LANGUAGES: CardLanguage[] = ["EN"];

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

function buildParams(sp: CatalogSearchParams): SearchProductsParams {
  const category =
    sp.kategori && sp.kategori in CATEGORY_LABELS
      ? (sp.kategori as ProductCategory)
      : undefined;
  const language =
    sp.sprak && LANGUAGE_KEYS.includes(sp.sprak as CardLanguage)
      ? (sp.sprak as CardLanguage)
      : undefined;
  const sort =
    SORT_OPTIONS.find((o) => o.value === sp.sortera)?.sort ?? "popular";
  const page = Math.max(1, Number(sp.sida) || 1);

  return {
    query: sp.q?.trim() || undefined,
    category,
    setId: sp.set || undefined,
    retailerId: sp.butik || undefined,
    minPrice: parseKr(sp.minPris),
    maxPrice: parseKr(sp.maxPris),
    stockStatus: sp.lager === "1" ? "IN_STOCK" : undefined,
    language,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Serialiserar filtren till feed-API:ts query (engelska parametrar). */
function buildFeedQuery(p: SearchProductsParams): string {
  const s = new URLSearchParams();
  if (p.query) s.set("query", p.query);
  if (p.category) s.set("category", p.category);
  if (p.setId) s.set("setId", p.setId);
  if (p.retailerId) s.set("retailerId", p.retailerId);
  if (p.minPrice !== undefined) s.set("minPrice", String(p.minPrice));
  if (p.maxPrice !== undefined) s.set("maxPrice", String(p.maxPrice));
  if (p.stockStatus) s.set("stockStatus", p.stockStatus);
  if (p.language) s.set("language", p.language);
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
        <Input
          id="q"
          name="q"
          type="search"
          placeholder={t("searchPlaceholder")}
          defaultValue={defaultQuery ?? ""}
          className="flex-1"
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
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}kategori`}>{t("category")}</Label>
        <Select id={`${idPrefix}kategori`} name="kategori" defaultValue={searchParams.kategori ?? ""}>
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
        <Select id={`${idPrefix}butik`} name="butik" defaultValue={searchParams.butik ?? ""}>
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
        <Select id={`${idPrefix}sprak`} name="sprak" defaultValue={searchParams.sprak ?? ""}>
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
  const params = buildParams(searchParams);
  const [result, sets, retailers, recentSets] = await Promise.all([
    getExploreFeed(params, 0, PAGE_SIZE),
    prisma.cardSet.findMany({
      select: { id: true, name: true },
      orderBy: { releaseDate: "desc" },
    }),
    prisma.retailer.findMany({
      where: { isActive: true, name: { notIn: NON_STORE_RETAILER_NAMES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // "Just Dropped" — senast släppta set.
    prisma.cardSet.findMany({
      where: { releaseDate: { not: null } },
      select: { id: true, name: true, logoUrl: true, totalCards: true },
      orderBy: { releaseDate: "desc" },
      take: 12,
    }),
  ]);
  const feedQuery = buildFeedQuery(params);

  const resultCount = t("resultCount", { count: result.total });

  const feed =
    result.items.length === 0 ? (
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
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recentSets.map((s) => (
          <Link
            key={s.id}
            href={`/sets/${s.id}`}
            className="card-surface group w-44 shrink-0 overflow-hidden transition-colors hover:border-holo-cyan/40"
          >
            <div className="flex h-24 w-full items-center justify-center bg-surface-overlay p-4">
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      {/* Rubrik — endast desktop (mobilen leder med sökfältet) */}
      <div className="hidden lg:block">
        <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
        <p className="mt-2 text-ink-muted">
          {t("intro")}
        </p>
      </div>

      {/* ───────── Mobil: app-känsla ───────── */}
      <div className="space-y-8 lg:hidden">
        {/* Sök alltid användbar; filtren fälls ut via filter-ikonen (peer-checkbox, ingen JS) */}
        <form method="GET" action="/produkter" className="space-y-3">
          <input type="checkbox" id="filt-toggle" className="peer sr-only" />
          <div className="flex items-center gap-1 rounded-xl border border-surface-border bg-surface-raised/40 px-3 transition-colors focus-within:border-holo-cyan/60">
            <IconSearch size={18} className="shrink-0 text-ink-muted" />
            <input
              name="q"
              type="search"
              defaultValue={searchParams.q ?? ""}
              placeholder={t("mobileSearchPlaceholder")}
              className="w-full bg-transparent py-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <label
              htmlFor="filt-toggle"
              aria-label={t("filterAria")}
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors hover:text-holo-cyan peer-checked:text-holo-cyan"
            >
              <IconFilter size={20} />
            </label>
          </div>
          <div className="card-surface hidden space-y-4 p-5 peer-checked:block">
            <CatalogFilterFields
              searchParams={searchParams}
              sets={sets}
              retailers={retailers}
              idPrefix="m-"
            />
          </div>
        </form>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-xl font-bold text-ink">{t("catalogTitle")}</h2>
            <span className="text-xs font-medium text-ink-muted" aria-live="polite">
              {resultCount}
            </span>
          </div>
          {feed}
        </section>

        {justDropped}
      </div>

      {/* ───────── Desktop: sidofält + resultat ───────── */}
      <div className="mt-8 hidden gap-8 lg:grid lg:grid-cols-[260px_1fr]">
        <aside>
          <form
            method="GET"
            action="/produkter"
            className="card-surface sticky top-20 space-y-4 p-5"
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
