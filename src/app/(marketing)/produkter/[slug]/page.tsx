/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatPrice, formatRelative } from "@/lib/format";
import {
  getPriceHistoryBySource,
  getProductBySlug,
  getSimilarProducts,
} from "@/services/products";
import { StockBadge } from "@/components/ui/badge";
import { ProductPriceCard } from "@/components/features/product-price-card";
import { ProductCard, CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductActions } from "@/components/features/product-actions";
import { isDirectOfferUrl, traderaSearchUrlSpecific } from "@/lib/marketplace-urls";
import {
  LivePricingProvider,
  LivePricePanel,
  LiveOffersTable,
} from "@/components/features/live-product-pricing";
import { IconCards } from "@/components/ui/icons";

// Produktsidan läser inte längre URL-param (perioden filtreras i klienten) eller
// session → den kan ISR-cachas. Live-priser/offers uppdateras ändå klient-sida via
// polling. Sparar Vercel CPU + Neon på den största crawl-ytan (~20k produktsidor).
export const revalidate = 3600;

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

const MAX_DAYS = 3650; // ~10 år → "hela serien" (klienten filtrerar perioden)

interface PageProps {
  params: { slug: string };
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const product = await loadProduct(params.slug);
  if (!product) return { title: "Produkten hittades inte" };
  const categoryLabel = CATEGORY_LABELS[product.category] ?? "Produkt";
  const description =
    product.description ??
    `Jämför priser på ${product.title} (${categoryLabel}) hos svenska butiker. Lägsta pris just nu: ${formatPrice(product.lowestPrice)}. Bevaka pris och restock på Foilio.`;
  return {
    title: product.title,
    description,
    openGraph: {
      title: product.title,
      description,
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const product = await loadProduct(params.slug);
  if (!product) notFound();

  const [historyBySource, similar, affiliateRetailers] = await Promise.all([
    getPriceHistoryBySource(product.id, MAX_DAYS),
    getSimilarProducts(product.id, 4),
    prisma.retailer.findMany({
      where: {
        id: { in: product.offers.map((o) => o.retailerId) },
        affiliateEnabled: true,
      },
      select: { id: true },
    }),
  ]);
  const affiliateIds = new Set(affiliateRetailers.map((r) => r.id));

  // Endast offers med direkt produktlänk visas och räknas — sök-/bläddringslänkar
  // (t.ex. Cardmarket-sök, utgångna Tradera-annonser) döljs helt.
  const directOffers = product.offers.filter((o) => isDirectOfferUrl(o.url));

  const prices = directOffers
    .map((o) => o.price)
    .filter((p): p is number => p !== null);
  const highestNow = prices.length > 0 ? Math.max(...prices) : null;
  const avgNow =
    prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;
  // Lägsta pris bland direkta, köpbara offers (IN_STOCK prioriteras).
  const directPriced = directOffers.filter(
    (o): o is (typeof directOffers)[number] & { price: number } => o.price !== null
  );
  const directInStock = directPriced.filter((o) => o.stockStatus === "IN_STOCK");
  const lowestPool = directInStock.length > 0 ? directInStock : directPriced;
  const directLowest =
    lowestPool.length > 0
      ? lowestPool.reduce((a, b) => (b.price < a.price ? b : a))
      : null;

  // Prishistorik och prisförändring baseras enbart på Cardmarket (tidigare
  // sålda Tradera-varor går inte att hämta legitimt). Hela serien skickas till
  // klient-kortet som filtrerar vald period; 30d-snittet räcker att slica ut här.
  const chartData = historyBySource.cardmarket;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const cm30 = chartData.filter((p) => new Date(p.date).getTime() >= monthAgo);

  const pctChange = (series: { price: number }[]): number | null =>
    series.length >= 2 && series[0].price > 0
      ? Math.round(
          ((series[series.length - 1].price - series[0].price) / series[0].price) * 10000
        ) / 100
      : null;

  const change30 = pctChange(cm30);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const change7 = pctChange(cm30.filter((p) => new Date(p.date).getTime() >= weekAgo));

  const lastInStock = product.restockEvents.find((e) => e.newStatus === "IN_STOCK");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description ?? undefined,
    image: product.imageUrl ?? undefined,
    offers:
      directLowest != null && highestNow != null
        ? {
            "@type": "AggregateOffer",
            priceCurrency: "SEK",
            lowPrice: (directLowest.price / 100).toFixed(2),
            highPrice: (highestNow / 100).toFixed(2),
            offerCount: directOffers.length,
            availability:
              directLowest.stockStatus === "IN_STOCK"
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
          }
        : undefined,
  };

  // Serialisera offers för klient-komponenten (endast direkta produktlänkar)
  const serializedOffers = directOffers.map((o) => ({
    id: o.id,
    price: o.price,
    shippingPrice: o.shippingPrice,
    stockStatus: o.stockStatus,
    url: o.url,
    retailerId: o.retailerId,
    retailer: {
      id: o.retailer.id,
      name: o.retailer.name,
      logoUrl: o.retailer.logoUrl,
      websiteUrl: o.retailer.websiteUrl,
      affiliateEnabled: affiliateIds.has(o.retailerId),
    },
  }));

  return (
    <LivePricingProvider
      slug={product.slug}
      initialOffers={serializedOffers}
      initialStats={{
        lowestPrice: directLowest?.price ?? null,
        lowestPriceStockStatus: directLowest?.stockStatus ?? null,
        highestPrice: highestNow,
        avgPrice: avgNow,
        offerCount: directOffers.length,
      }}
      affiliateRetailerIds={affiliateRetailers.map((r) => r.id)}
      initialUpdatedAt={new Date(product.updatedAt).toISOString()}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        {/* Breadcrumb */}
        <nav aria-label="Brödsmulor" className="mb-4 text-sm text-ink-muted">
          <Link href="/produkter" className="hover:text-ink">Produkter</Link>
          {product.set && (
            <>
              <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
              <Link href={`/sets/${product.set.id}`} className="hover:text-ink">
                {product.set.name}
              </Link>
            </>
          )}
          <span className="mx-2 text-ink-faint" aria-hidden="true">›</span>
          <span className="text-ink">{product.title}</span>
        </nav>

        {/* Title */}
        <header>
          <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">
            {product.title}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {product.set && (
              <>
                <Link
                  href={`/sets/${product.set.id}`}
                  className="text-holo-cyan hover:underline"
                >
                  {product.set.name}
                </Link>
                <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
              </>
            )}
            {CATEGORY_LABELS[product.category] ?? CATEGORY_LABELS.OTHER}
            <span className="mx-2 text-ink-faint" aria-hidden="true">·</span>
            {LANGUAGE_LABELS[product.language] ?? product.language}
          </p>
        </header>

        {/* Bild | Prishistorik */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="card-surface flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-overlay lg:aspect-auto">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <IconCards size={72} className="text-ink-faint" />
              </div>
            )}
          </div>

          <ProductPriceCard
            title={
              product.category === "SINGLE_CARD" ? "Ograderad prishistorik" : "Prishistorik"
            }
            subtitle={
              product.category === "SINGLE_CARD"
                ? "Raw (Near Mint), ej graderad · Cardmarket"
                : "Marknadstrend · Cardmarket"
            }
            series={chartData}
          />
        </div>

        {/* Prispanel — live-uppdateras via polling */}
        <LivePricePanel
          priceChange7dPercent={change7}
          change30={change30}
          priceLabel={
            product.category === "SINGLE_CARD"
              ? "Lägsta pris · NM engelska (Cardmarket)"
              : "Lägsta pris just nu"
          }
        />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ProductActions productId={product.id} title={product.title} />
          <p className="text-xs text-ink-faint">
            {product.watchCount === 1
              ? "1 samlare bevakar denna produkt"
              : `${product.watchCount} samlare bevakar denna produkt`}
          </p>
        </div>
        {product.description && (
          <p className="mt-6 max-w-2xl text-sm text-ink-muted">{product.description}</p>
        )}

        {/* Erbjudanden — live-uppdateras via polling */}
        <LiveOffersTable
          slug={product.slug}
          traderaSearch={
            SEALED_CATEGORIES.includes(product.category)
              ? traderaSearchUrlSpecific(product.title, product.category)
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
              {" "}hos {lastInStock.retailer.name}
            </p>
          )}
          {product.restockEvents.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Inga registrerade lagerförändringar ännu.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {product.restockEvents.slice(0, 10).map((event) => (
                <li
                  key={event.id}
                  className="card-surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="text-ink">
                    {event.retailer.name}
                    <StockBadge stockStatus={event.newStatus} className="ml-2" />
                  </span>
                  <span className="text-ink-muted">{formatRelative(event.detectedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Similar products */}
        {similar.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold text-ink">
              Liknande produkter
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {similar.map((p) => (
                <ProductCard
                  key={p.id}
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
