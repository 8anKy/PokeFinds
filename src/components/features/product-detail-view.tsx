"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { formatPrice, formatRelative } from "@/lib/format";
import type { ProductDetailData } from "@/services/products";
import { StockBadge } from "@/components/ui/badge";
import { ProductPriceCard } from "@/components/features/product-price-card";
import { ProductCard, CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductActions } from "@/components/features/product-actions";
import { traderaSearchUrlSpecific } from "@/lib/marketplace-urls";
import {
  LivePricingProvider,
  LivePricePanel,
  LiveOffersTable,
} from "@/components/features/live-product-pricing";
import { IconCards } from "@/components/ui/icons";

/** Sealed-kategorier (ej singel/gradat) — får alltid en Tradera-länk. */
const SEALED_CATEGORIES: string[] = [
  "BOOSTER_BOX",
  "BOOSTER_PACK",
  "ETB",
  "COLLECTION_BOX",
  "TIN",
  "BLISTER",
  "BUNDLE",
];

const LANGUAGE_LABELS: Record<string, string> = {
  SV: "Svenska",
  EN: "Engelska",
  JP: "Japanska",
  DE: "Tyska",
  FR: "Franska",
  OTHER: "Övrigt",
};

/**
 * Hela produktsidans innehåll, delat av SSR-sidan (`/produkter/[slug]`) och
 * produkt-overlayn. Ren presentation — all data kommer serialiserad via
 * `loadProductDetail`. JSON-LD ligger kvar på SSR-sidan (SEO), inte här.
 */
export function ProductDetailView({ data }: { data: ProductDetailData }) {
  const lastInStock = data.restockEvents.find((e) => e.newStatus === "IN_STOCK");
  const isSingle = data.category === "SINGLE_CARD";

  return (
    <LivePricingProvider
      slug={data.slug}
      initialOffers={data.serializedOffers}
      initialStats={data.stats}
      affiliateRetailerIds={data.affiliateRetailerIds}
      initialUpdatedAt={data.updatedAt}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Breadcrumb */}
        <nav aria-label="Brödsmulor" className="mb-4 text-sm text-ink-muted">
          <Link href="/produkter" className="hover:text-ink">Produkter</Link>
          {data.set && (
            <>
              <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
              <Link href={`/sets/${data.set.id}`} className="hover:text-ink">
                {data.set.name}
              </Link>
            </>
          )}
          <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
          <span className="text-ink">{data.title}</span>
        </nav>

        {/* Title */}
        <header>
          <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
            {data.title}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {data.set && (
              <>
                <Link
                  href={`/sets/${data.set.id}`}
                  className="text-holo-cyan hover:underline"
                >
                  {data.set.name}
                </Link>
                <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
              </>
            )}
            {CATEGORY_LABELS[data.category] ?? CATEGORY_LABELS.OTHER}
            <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
            {LANGUAGE_LABELS[data.language] ?? data.language}
          </p>
        </header>

        {/* Andra Cardmarket-versioner av samma kort (common ↔ special-variant) */}
        {data.variants.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-muted">Andra versioner:</span>
            {data.variants.map((v) => (
              <Link
                key={v.slug}
                href={`/produkter/${v.slug}`}
                className="card-surface rounded-full px-3 py-1 text-ink transition hover:text-holo-cyan"
              >
                {v.label}
                {v.lowestPrice != null && (
                  <span className="text-ink-muted"> · {formatPrice(v.lowestPrice)}</span>
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Bild | Prishistorik */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="card-surface flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-overlay lg:aspect-auto">
            {data.imageUrl ? (
              <img
                src={data.imageUrl}
                alt={data.title}
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <IconCards size={72} className="text-ink-faint" />
              </div>
            )}
          </div>

          <ProductPriceCard
            title={isSingle ? "Ograderad prishistorik" : "Prishistorik"}
            subtitle={
              isSingle
                ? "Raw (Near Mint), ej graderad · Cardmarket"
                : "Marknadstrend · Cardmarket"
            }
            series={data.chartData}
          />
        </div>

        {/* Prispanel — live-uppdateras via polling */}
        <LivePricePanel
          priceChange7dPercent={data.change7}
          change30={data.change30}
          priceLabel={
            isSingle ? "Lägsta pris · NM engelska (Cardmarket)" : "Lägsta pris just nu"
          }
        />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ProductActions productId={data.id} title={data.title} />
          <p className="text-xs text-ink-faint">
            {data.watchCount === 1
              ? "1 samlare bevakar denna produkt"
              : `${data.watchCount} samlare bevakar denna produkt`}
          </p>
        </div>
        {data.description && (
          <p className="mt-6 max-w-2xl text-sm text-ink-muted">{data.description}</p>
        )}

        {/* Erbjudanden — live-uppdateras via polling */}
        <LiveOffersTable
          slug={data.slug}
          traderaSearch={
            SEALED_CATEGORIES.includes(data.category)
              ? traderaSearchUrlSpecific(data.title, data.category)
              : null
          }
        />

        {/* Restock history */}
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold text-ink">
            Restock-historik
          </h2>
          {lastInStock && (
            <p className="mt-2 text-sm text-ink-muted">
              Senast i lager: <span className="text-rise">{formatRelative(lastInStock.detectedAt)}</span>
              {" "}hos {lastInStock.retailerName}
            </p>
          )}
          {data.restockEvents.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Inga registrerade lagerförändringar ännu.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.restockEvents.slice(0, 10).map((event) => (
                <li
                  key={event.id}
                  className="card-surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="text-ink">
                    {event.retailerName}
                    <StockBadge stockStatus={event.newStatus} className="ml-2" />
                  </span>
                  <span className="text-ink-muted">{formatRelative(event.detectedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Similar products */}
        {data.similar.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-ink">
              Liknande produkter
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {data.similar.map((p) => (
                <ProductCard
                  key={p.slug}
                  product={{
                    slug: p.slug,
                    title: p.title,
                    imageUrl: p.imageUrl,
                    category: p.category,
                    lowestPrice: p.lowestPrice,
                    stockStatus: p.lowestPriceStockStatus,
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </LivePricingProvider>
  );
}
