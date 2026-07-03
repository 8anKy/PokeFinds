import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductCard } from "@/components/features/product-card";
import { IconPackage } from "@/components/ui/icons";

// Set-data ändras ~en gång/dygn → cacha per set (ISR). Sparar Vercel CPU + Neon.
export const revalidate = 3600;

// Tom lista → inget prerenderas vid build; varje set genereras on-demand vid
// första besök och cachas sedan (ISR). KRÄVS för cache: utan generateStaticParams
// renderas dynamiska segment dynamiskt per request (no-store) trots `revalidate`.
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; id: string };
}

async function getSet(id: string) {
  return prisma.cardSet.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          offers: { select: { price: true, stockStatus: true } },
        },
        orderBy: { viewCount: "desc" },
      },
      _count: { select: { cards: true } },
    },
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Sets" });
  const set = await prisma.cardSet.findUnique({
    where: { id: params.id },
    select: { name: true, series: true },
  });
  if (!set) return { title: t("notFound") };
  return {
    title: set.name,
    description: t("detailDescription", { name: set.name, series: set.series }),
  };
}

export default async function SetPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Sets");
  const set = await getSet(params.id);
  if (!set) notFound();

  const products = set.products.map((p) => {
    const priced = p.offers.filter(
      (o): o is (typeof p.offers)[number] & { price: number } => o.price !== null
    );
    const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
    const pool = inStock.length > 0 ? inStock : priced;
    const best =
      pool.length > 0 ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    return {
      ...p,
      lowestPrice: best?.price ?? null,
      lowestPriceStockStatus: best?.stockStatus ?? null,
      inStockCount: p.offers.filter((o) => o.stockStatus === "IN_STOCK").length,
    };
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <nav aria-label={t("breadcrumb")} className="mb-6 text-sm text-ink-muted">
        <Link href="/sets" className="hover:text-ink">{t("breadcrumb")}</Link>
        <span className="mx-2 text-ink-faint" aria-hidden="true">/</span>
        <span className="text-ink">{set.name}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold text-ink">{set.name}</h1>
        <Badge variant="holo">{set.series}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        {t("releaseColon", { date: formatDate(set.releaseDate) })} ·{" "}
        {t("cards", { count: set.totalCards > 0 ? set.totalCards : set._count.cards })} ·{" "}
        {t("products", { count: products.length })}
      </p>

      {products.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<IconPackage size={32} />}
          title={t("emptyProductsTitle")}
          description={t("emptyProductsDesc")}
        />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={{
                slug: p.slug,
                title: p.title,
                imageUrl: p.imageUrl,
                category: p.category,
                lowestPrice: p.lowestPrice,
                stockStatus: p.lowestPriceStockStatus,
                retailerCount: p.inStockCount,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
