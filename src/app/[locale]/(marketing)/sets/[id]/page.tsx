import type { Metadata } from "next";
import { alternatesFor, localeUrl } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SetProductGrid } from "@/components/features/set-product-grid";
import { SetCompletionBar } from "@/components/features/set-completion-bar";
import { SetWatchButton } from "@/components/features/set-watch-button";
import { isSealedCategory } from "@/lib/product-category";
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

// ⛔ `select` på `products`, inte `include` (2026-08-05): ett set kan ha hundratals
// produkter, och `include` hämtade HELA produktraden — `description` (fritext),
// `normalizedTitle`, `gtin*`, alla räknare och tidsstämplar. Rutnätet nedan använder
// exakt sex fält. Lägg till fält här när mappningen behöver dem (tsc fångar det,
// eftersom hela konsumtionen sker i den här filen).
async function getSet(id: string) {
  return prisma.cardSet.findUnique({
    where: { id },
    include: {
      products: {
        select: {
          id: true,
          slug: true,
          title: true,
          imageUrl: true,
          category: true,
          variantLabel: true,
          // cardId behövs av "visa bara saknade" i rutnätet — `ownedCardIds`
          // från /api/sets/[id]/completion är KORT-id:n, inte produkt-id:n.
          cardId: true,
          card: { select: { name: true, number: true, rarity: true } },
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
    // Bara `set.name` gav en flik och en SERP-rad som lyder "Surging Sparks | Foilio"
    // — ett setnamn utan ett ord om att sidan visar PRISER och kort. Den som söker
    // "surging sparks pris" har ingen anledning att klicka på ett bart namn.
    title: t("detailTitle", { name: set.name }),
    description: t("detailDescription", { name: set.name, series: set.series }),
    alternates: alternatesFor(params.locale, `/sets/${params.id}`),
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

  // Räknas ur produkterna vi redan hämtat — ingen extra fråga för siffran under
  // bevakningsknappen ("larm på 26 sealed-produkter").
  const sealedCount = products.filter((p) => isSealedCategory(p.category)).length;

  // Speglar EXAKT den synliga stigen nedan (Set / {set.name}): samma två steg, samma
  // ordning, samma namn. Strukturerad data som påstår något sidan inte visar är det
  // Google utfärdar manuella åtgärder för — här finns per konstruktion inget glapp.
  // ⛔ Ingen ny fråga: namnet kommer ur `getSet` ovan och id:t ur `params`.
  // Noden bor därför i sidan och inte i `generateMetadata` — Metadata-API:t skriver
  // `<meta>`/`<link>`, JSON-LD måste renderas som en tagg i själva sidan.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: t("breadcrumb"),
        item: localeUrl(params.locale, "/sets"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: set.name,
        item: localeUrl(params.locale, `/sets/${params.id}`),
      },
    ],
  };

  return (
    <div className="mx-auto max-w-7xl px-2.5 py-10 sm:px-6">
      {/* <-escapen: JSON.stringify escapar inte "<", så ett setnamn med
          "</script>" skulle annars bryta sig ut ur script-taggen. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <nav aria-label={t("breadcrumb")} className="mb-6 text-sm text-ink-muted">
        <Link href="/sets" className="hover:text-ink">{t("breadcrumb")}</Link>
        <span className="mx-2 text-ink-faint" aria-hidden="true">/</span>
        <span className="text-ink">{set.name}</span>
      </nav>

      {/* Rubrik vänster, åtgärd höger — samma form som /bevakningar. På mobil
          faller knappen ner under metaraden i stället för att tränga rubriken. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-ink">{set.name}</h1>
            <Badge variant="holo">{set.series}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {t("releaseColon", { date: formatDate(set.releaseDate) })} ·{" "}
            {t("cards", { count: set.totalCards > 0 ? set.totalCards : set._count.cards })} ·{" "}
            {t("products", { count: products.length })}
          </p>
        </div>
        {/* Knappen finns BARA när setet faktiskt har sealed att bevaka — annars
            vore den ett löfte om larm som aldrig kan avfyras (singlar restockar
            inte i butiksfeeden). */}
        {sealedCount > 0 && (
          <SetWatchButton setId={set.id} setName={set.name} sealedCount={sealedCount} />
        )}
      </div>

      {/* Progressraden gör INGET på servern — den ritar sig själv först när den
          inloggades siffra landat klient-sida (ISR-regeln, se komponenten).
          Renderas bara för set som faktiskt HAR kort: ett rent sealed-set har
          ingen komplettering att mäta. */}
      {set._count.cards > 0 && <SetCompletionBar setId={set.id} />}

      {products.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<IconPackage size={32} />}
          title={t("emptyProductsTitle")}
          description={t("emptyProductsDesc")}
        />
      ) : (
        <SetProductGrid
          setId={set.id}
          products={products.map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            imageUrl: p.imageUrl,
            category: p.category,
            cardId: p.cardId,
            setId: set.id,
            setName: set.name,
            setTotalCards: set.totalCards,
            cardName: p.card?.name ?? null,
            cardNumber: p.card?.number ?? null,
            cardRarity: p.card?.rarity ?? null,
            variantLabel: p.variantLabel,
            lowestPrice: p.lowestPrice,
            stockStatus: p.lowestPriceStockStatus,
            retailerCount: p.inStockCount,
          }))}
        />
      )}
    </div>
  );
}
