import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { PriceChange } from "@/components/ui/price-change";
import { StockBadge } from "@/components/ui/badge";
import {
  IconBookmark,
  IconCards,
  IconGem,
  IconGift,
  IconPackage,
  IconShield,
  IconSparkle,
  IconTrophy,
  type IconProps,
} from "@/components/ui/icons";

export const CATEGORY_LABELS: Record<string, string> = {
  SINGLE_CARD: "Singelkort",
  BOOSTER_BOX: "Booster Box",
  BOOSTER_PACK: "Booster Pack",
  ETB: "Elite Trainer Box",
  COLLECTION_BOX: "Collection Box",
  TIN: "Tin",
  BLISTER: "Blister",
  BUNDLE: "Bundle",
  ACCESSORY: "Tillbehör",
  GRADED_CARD: "Gradat kort",
  OTHER: "Övrigt",
};

const CATEGORY_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  SINGLE_CARD: IconCards,
  BOOSTER_BOX: IconPackage,
  BOOSTER_PACK: IconSparkle,
  ETB: IconGift,
  COLLECTION_BOX: IconGem,
  TIN: IconPackage,
  BLISTER: IconBookmark,
  BUNDLE: IconPackage,
  ACCESSORY: IconShield,
  GRADED_CARD: IconTrophy,
  OTHER: IconCards,
};

export interface ProductCardProps {
  product: {
    slug: string;
    title: string;
    imageUrl?: string | null;
    category: string;
    lowestPrice?: number | null;
    priceChange7d?: number | null;
    stockStatus?: string | null;
    retailerCount?: number;
    dealPercent?: number | null; // Fynd-feed: % under Cardmarket-referens
    dealListingTitle?: string | null; // Fynd-feed: verifierad Tradera-annonstitel
  };
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const tCat = useTranslations("Category");
  const tProduct = useTranslations("Product");
  const categoryLabel = product.category in CATEGORY_LABELS ? tCat(product.category) : tCat("OTHER");
  const CategoryIcon = CATEGORY_ICONS[product.category] ?? CATEGORY_ICONS.OTHER;

  return (
    <Link
      href={`/produkter/${product.slug}`}
      className={cn(
        "card-surface group block overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-holo-cyan/40 hover:shadow-glow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
        className
      )}
    >
      {/* Bild eller kategoriikon som placeholder */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-overlay">
        {product.dealPercent != null && product.dealPercent > 0 && (
          <span className="absolute left-2 top-2 z-10 rounded-md bg-holo-cyan px-1.5 py-0.5 text-[11px] font-bold text-surface shadow">
            −{product.dealPercent}%
          </span>
        )}
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-ink-faint"
            aria-hidden="true"
          >
            <CategoryIcon size={40} />
          </div>
        )}
      </div>

      <div className="space-y-2 p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          {categoryLabel}
        </p>
        <h3 className="line-clamp-2 min-h-[2.25rem] text-sm font-medium leading-snug text-ink transition-colors group-hover:text-holo-cyan">
          {product.title}
        </h3>

        <div className="pt-0.5">
          <p data-price className="font-display text-lg font-bold tracking-tight text-ink">
            {formatPrice(product.lowestPrice)}
          </p>
          {/* Konsekvent rad: prisförändring vänster, lagerstatus alltid höger. */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {product.priceChange7d != null ? (
              <PriceChange percent={product.priceChange7d} className="text-xs" hideIcon />
            ) : (
              <span />
            )}
            {product.stockStatus && (
              <StockBadge stockStatus={product.stockStatus} className="min-w-[4.75rem] justify-center" />
            )}
          </div>
        </div>

        {product.dealListingTitle ? (
          <p className="line-clamp-1 text-[11px] text-ink-faint" title={product.dealListingTitle}>
            Tradera: {product.dealListingTitle}
          </p>
        ) : (
          product.retailerCount != null &&
          product.retailerCount > 0 && (
            <p className="text-[11px] text-ink-faint">
              {tProduct("atStores", { count: product.retailerCount })}
            </p>
          )
        )}
      </div>
    </Link>
  );
}
