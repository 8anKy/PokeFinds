import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import { getProductBySlug, loadProductDetail } from "@/services/products";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { ProductDetailView } from "@/components/features/product-detail-view";

// Produktsidan läser inte längre URL-param (perioden filtreras i klienten) eller
// session → den kan ISR-cachas. Live-priser/offers uppdateras ändå klient-sida via
// polling. Sparar Vercel CPU + Neon på den största crawl-ytan (~20k produktsidor).
export const revalidate = 3600;

// Tom lista → inget prerenderas vid build (undvik ~20k renders); varje slug
// genereras on-demand vid första besök och cachas sedan (ISR). KRÄVS för cache:
// utan generateStaticParams renderas dynamiska segment dynamiskt per request
// (no-store) trots `revalidate`.
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; slug: string };
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Detail" });
  const tCat = await getTranslations({ locale: params.locale, namespace: "Category" });
  const product = await loadProduct(params.slug);
  if (!product) return { title: t("metaNotFound") };
  const categoryLabel =
    product.category in CATEGORY_LABELS ? tCat(product.category) : t("fallbackCategory");
  const description =
    product.description ??
    t("metaDescription", {
      title: product.title,
      category: categoryLabel,
      price: formatPrice(product.lowestPrice),
    });
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
  const data = await loadProductDetail(params.slug);
  if (!data) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: data.title,
    description: data.description ?? undefined,
    image: data.imageUrl ?? undefined,
    offers:
      data.stats.lowestPrice != null && data.stats.highestPrice != null
        ? {
            "@type": "AggregateOffer",
            priceCurrency: "SEK",
            lowPrice: (data.stats.lowestPrice / 100).toFixed(2),
            highPrice: (data.stats.highestPrice / 100).toFixed(2),
            offerCount: data.offerCount,
            availability:
              data.stats.lowestPriceStockStatus === "IN_STOCK"
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
          }
        : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProductDetailView data={data} />
    </>
  );
}
