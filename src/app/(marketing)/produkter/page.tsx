import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  getExploreFeed,
  HIDDEN_CATEGORIES,
  type ProductSort,
  type SearchProductsParams,
} from "@/services/products";
import type { CardLanguage, ProductCategory } from "@prisma/client";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ExploreFeed } from "@/components/features/explore-feed";
import { Input, Select, Label, Checkbox } from "@/components/ui/input";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch, IconScan } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Utforska produkter",
  description:
    "Sök och jämför priser på Pokémon TCG-produkter hos svenska butiker. Filtrera på kategori, set, pris och lagerstatus.",
};

const PAGE_SIZE = 24;

const SORT_OPTIONS: { value: string; label: string; sort: ProductSort }[] = [
  { value: "popular", label: "Mest populär", sort: "popular" },
  { value: "lagsta-pris", label: "Lägsta pris", sort: "price_asc" },
  { value: "hogsta-pris", label: "Högsta pris", sort: "price_desc" },
  { value: "prisfall", label: "Störst prisfall", sort: "biggest_drop" },
  { value: "restock", label: "Senast restockad", sort: "recently_restocked" },
  { value: "bevakad", label: "Mest bevakad", sort: "most_watched" },
  { value: "trend", label: "Trendar", sort: "trending" },
];

const LANGUAGE_LABELS: Record<CardLanguage, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övriga",
};

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

function buildParams(sp: CatalogSearchParams): SearchProductsParams {
  const category =
    sp.kategori && sp.kategori in CATEGORY_LABELS
      ? (sp.kategori as ProductCategory)
      : undefined;
  const language =
    sp.sprak && sp.sprak in LANGUAGE_LABELS ? (sp.sprak as CardLanguage) : undefined;
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: CatalogSearchParams;
}) {
  const params = buildParams(searchParams);
  const [result, sets, retailers] = await Promise.all([
    getExploreFeed(params, 0, PAGE_SIZE),
    prisma.cardSet.findMany({
      select: { id: true, name: true },
      orderBy: { releaseDate: "desc" },
    }),
    prisma.retailer.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const feedQuery = buildFeedQuery(params);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Utforska produkter</h1>
      <p className="mt-2 text-ink-muted">
        Jämför priser och lagerstatus hos svenska butiker — och bevaka det du inte
        vill missa.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* Filter sidebar */}
        <aside>
          <form method="GET" action="/produkter" className="card-surface sticky top-20 space-y-4 p-5">
            <div>
              <Label htmlFor="q">Sök</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="q"
                  name="q"
                  type="search"
                  placeholder="T.ex. Charizard, Booster Box…"
                  defaultValue={searchParams.q ?? ""}
                  className="flex-1"
                />
                <Link
                  href="/skanna"
                  aria-label="Identifiera kort med kameran"
                  title="Skanna ett kort med kameran"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-border bg-surface-overlay text-ink-muted transition-colors hover:border-holo-cyan/60 hover:text-holo-cyan focus-visible:border-holo-cyan/60 focus-visible:text-holo-cyan"
                >
                  <IconScan size={20} />
                </Link>
              </div>
            </div>
            <div>
              <Label htmlFor="kategori">Kategori</Label>
              <Select id="kategori" name="kategori" defaultValue={searchParams.kategori ?? ""}>
                <option value="">Alla kategorier</option>
                {Object.entries(CATEGORY_LABELS)
                  .filter(([value]) => !HIDDEN_CATEGORIES.includes(value as ProductCategory))
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="set">Set</Label>
              <Select id="set" name="set" defaultValue={searchParams.set ?? ""}>
                <option value="">Alla set</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="butik">Butik</Label>
              <Select id="butik" name="butik" defaultValue={searchParams.butik ?? ""}>
                <option value="">Alla butiker</option>
                {retailers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Pris (kr)</Label>
              <div className="flex items-center gap-2">
                <Input
                  name="minPris"
                  type="number"
                  min={0}
                  placeholder="Min"
                  aria-label="Lägsta pris i kronor"
                  defaultValue={searchParams.minPris ?? ""}
                />
                <span className="text-ink-faint">–</span>
                <Input
                  name="maxPris"
                  type="number"
                  min={0}
                  placeholder="Max"
                  aria-label="Högsta pris i kronor"
                  defaultValue={searchParams.maxPris ?? ""}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="sprak">Språk</Label>
              <Select id="sprak" name="sprak" defaultValue={searchParams.sprak ?? ""}>
                <option value="">Alla språk</option>
                {BROWSE_LANGUAGES.map((value) => (
                  <option key={value} value={value}>
                    {LANGUAGE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <Checkbox
              id="lager"
              name="lager"
              value="1"
              label="Endast i lager"
              defaultChecked={searchParams.lager === "1"}
            />
            <div>
              <Label htmlFor="sortera">Sortera efter</Label>
              <Select id="sortera" name="sortera" defaultValue={searchParams.sortera ?? "popular"}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" className="w-full">
              Filtrera
            </Button>
            <Link
              href="/produkter"
              className="block text-center text-sm text-ink-muted hover:text-ink"
            >
              Rensa filter
            </Link>
          </form>
        </aside>

        {/* Results */}
        <section>
          <p className="mb-4 text-sm text-ink-muted" aria-live="polite">
            {result.total === 1
              ? "1 produkt hittades"
              : `${result.total} produkter hittades`}
          </p>

          {result.items.length === 0 ? (
            <EmptyState
              icon={<IconSearch size={32} />}
              title="Inga produkter matchade"
              description="Prova att bredda sökningen eller rensa filtren — marknaden fylls på hela tiden."
              action={
                <LinkButton href="/produkter" variant="secondary" size="sm">
                  Rensa filter
                </LinkButton>
              }
            />
          ) : (
            // key={feedQuery} → komponenten remountas (nollställer scroll-state)
            // när filter/sortering ändras.
            <ExploreFeed
              key={feedQuery}
              initialItems={result.items}
              initialHasMore={result.hasMore}
              feedQuery={feedQuery}
              pageSize={PAGE_SIZE}
            />
          )}
        </section>
      </div>
    </div>
  );
}
