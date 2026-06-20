import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice, formatRelative } from "@/lib/format";
import {
  getMarketStats,
  getMostWatched,
  getRecentRestocks,
  getSetIndex,
  getTopDrops,
  getTrending,
} from "@/services/market";
import { LinkButton } from "@/components/ui/button";
import { PriceChange } from "@/components/ui/price-change";
import { StockBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import {
  IconBell,
  IconChart,
  IconEye,
  IconPackage,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";

// Marknadsöversikten ändras ~en gång/dygn → cacha (ISR). Sparar Vercel CPU + Neon.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Marknad",
  description:
    "Marknadsöversikt för Pokémon TCG i Sverige — trender, prisfall, mest bevakade produkter, restocks och prisindex per set.",
};

type ChangeItem = Awaited<ReturnType<typeof getTrending>>[number];

function ChangeList({ items, emptyText }: { items: ChangeItem[]; emptyText: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconChart size={32} />}
        title="Ingen data ännu"
        description={emptyText}
      />
    );
  }
  return (
    <ul className="card-surface divide-y divide-surface-border">
      {items.map((item) => (
        <li key={item.productId}>
          <Link
            href={`/produkter/${item.product.slug}`}
            className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/60"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink group-hover:text-holo-cyan">
                {item.product.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-faint">
                {CATEGORY_LABELS[item.product.category] ?? CATEGORY_LABELS.OTHER}
                {item.product.set ? ` · ${item.product.set.name}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right" data-price>
              <p className="text-sm font-semibold text-ink">
                {formatPrice(item.lastPrice)}
              </p>
              <p className="text-xs text-ink-faint line-through">
                {formatPrice(item.firstPrice)}
              </p>
            </div>
            <PriceChange
              percent={item.changePercent}
              className="w-[4.5rem] shrink-0 justify-end"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function MarketPage() {
  const [stats, trending, drops, mostWatched, restocks, setIndex] =
    await Promise.all([
      getMarketStats(),
      getTrending(6),
      getTopDrops(6),
      getMostWatched(6),
      getRecentRestocks(12),
      getSetIndex(),
    ]);

  const statItems = [
    { label: "bevakade produkter", value: stats.productCount.toLocaleString("sv-SE") },
    {
      label: "erbjudanden i lager",
      value: `${stats.inStockOffers.toLocaleString("sv-SE")} av ${stats.offerCount.toLocaleString("sv-SE")}`,
    },
    { label: "restocks senaste dygnet", value: stats.restocks24h.toLocaleString("sv-SE") },
    { label: "prisobservationer per dygn", value: stats.observations24h.toLocaleString("sv-SE") },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Marknaden</h1>
      <p className="mt-2 text-ink-muted">
        Läget på den svenska Pokémon TCG-marknaden just nu — uppdaterat löpande.
      </p>

      {/* Datapuls — kompakt rad istället för statkort */}
      <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-surface-border py-3 text-sm text-ink-muted">
        {statItems.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-x-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-ink-faint">
                ·
              </span>
            )}
            <span>
              <strong className="font-semibold tabular-nums text-ink">{s.value}</strong>{" "}
              {s.label}
            </span>
          </span>
        ))}
      </p>

      {/* Trendar + prisfall sida vid sida */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <IconTrendingUp size={20} className="text-rise" />
            Störst uppgång — 7 dagar
          </h2>
          <div className="mt-4">
            <ChangeList
              items={trending}
              emptyText="Vi behöver några dagars prisdata innan uppgångarna visas här."
            />
          </div>
        </section>
        <section>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <IconTrendingDown size={20} className="text-fall" />
            Största prisfall — 7 dagar
          </h2>
          <div className="mt-4">
            <ChangeList
              items={drops}
              emptyText="Vi behöver några dagars prisdata innan prisfallen visas här."
            />
          </div>
        </section>
      </div>

      {/* Mest bevakade */}
      <section className="mt-12">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
          <IconEye size={20} className="text-holo-violet" />
          Mest bevakade
        </h2>
        <div className="mt-4">
          {mostWatched.length === 0 ? (
            <EmptyState
              icon={<IconBell size={32} />}
              title="Inga bevakningar ännu"
              description="Bli först — skapa en bevakning på din favoritprodukt."
            />
          ) : (
            <ul className="card-surface divide-y divide-surface-border">
              {mostWatched.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/produkter/${p.slug}`}
                    className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/60"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-holo-cyan">
                      {p.title}
                    </p>
                    <span data-price className="shrink-0 text-sm font-semibold text-ink">
                      {formatPrice(p.lowestPrice)}
                    </span>
                    <span className="inline-flex w-16 shrink-0 items-center justify-end gap-1.5 text-sm tabular-nums text-holo-violet">
                      <IconBell size={15} />
                      {p.watchCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Restocks */}
      <section className="mt-12">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
          <IconPackage size={20} className="text-holo-cyan" />
          Senaste restocks
        </h2>
        <div className="mt-4">
          {restocks.length === 0 ? (
            <EmptyState
              icon={<IconPackage size={32} />}
              title="Inga restocks registrerade"
              description="När en slutsåld produkt kommer tillbaka i lager dyker den upp här."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Produkt</TH>
                  <TH>Butik</TH>
                  <TH>Status</TH>
                  <TH>När</TH>
                </TR>
              </THead>
              <TBody>
                {restocks.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link
                        href={`/produkter/${r.product.slug}`}
                        className="font-medium hover:text-holo-cyan"
                      >
                        {r.product.title}
                      </Link>
                    </TD>
                    <TD className="text-ink-muted">{r.retailer.name}</TD>
                    <TD>
                      <StockBadge stockStatus={r.newStatus} />
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {formatRelative(r.detectedAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      {/* Set index */}
      <section className="mt-12">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
          <IconChart size={20} className="text-holo-cyan" />
          Prisindex per set — 7 dagar
        </h2>
        <div className="mt-4">
          {setIndex.length === 0 ? (
            <EmptyState
              icon={<IconChart size={32} />}
              title="Inget index ännu"
              description="Prisindex per set visas när vi samlat in tillräckligt med data."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Set</TH>
                  <TH>Serie</TH>
                  <TH>Produkter</TH>
                  <TH>Snittförändring</TH>
                </TR>
              </THead>
              <TBody>
                {setIndex.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/sets/${s.id}`} className="font-medium hover:text-holo-cyan">
                        {s.name}
                      </Link>
                    </TD>
                    <TD className="text-ink-muted">{s.series}</TD>
                    <TD className="tabular-nums text-ink-muted">{s.productCount}</TD>
                    <TD>
                      <PriceChange percent={s.avgChangePercent} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      {/* Premium teaser */}
      <section className="mt-12">
        <div className="relative overflow-hidden rounded-2xl border border-holo-violet/30 bg-surface-raised p-8 text-center sm:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-holo-gradient opacity-[0.06]"
          />
          <h2 className="relative font-display text-2xl font-bold text-ink">
            Vill du gräva djupare i datan?
          </h2>
          <p className="relative mx-auto mt-2 max-w-xl text-ink-muted">
            Med Premium får du längre prishistorik, avancerade grafer,
            veckorapporter och snabbare restock-notiser — så att du agerar innan
            alla andra.
          </p>
          <div className="relative mt-6">
            <LinkButton href="/priser" size="lg">
              Se vad Premium ger dig
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}
