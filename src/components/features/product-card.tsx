import Link from "next/link";
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
  };
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const categoryLabel = CATEGORY_LABELS[product.category] ?? CATEGORY_LABELS.OTHER;
  const CategoryIcon = CATEGORY_ICONS[product.category] ?? CATEGORY_ICONS.OTHER;

  return (
    <Link
      href={`/produkter/${product.slug}`}
      className={cn(
        "card-surface group block overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-holo-cyan/40 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan",
        className
      )}
    >
      {/* Bild eller kategoriikon som placeholder */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-overlay">
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

        <div className="flex items-end justify-between gap-2 pt-0.5">
          <div>
            <p data-price className="font-display text-lg font-bold tracking-tight text-ink">
              {formatPrice(product.lowestPrice)}
            </p>
            {product.priceChange7d != null && (
              <PriceChange percent={product.priceChange7d} className="text-xs" hideIcon />
            )}
          </div>
          {product.stockStatus && <StockBadge stockStatus={product.stockStatus} />}
        </div>

        {product.retailerCount != null && product.retailerCount > 0 && (
          <p className="text-[11px] text-ink-faint">
            {product.retailerCount === 1
              ? "Hos 1 butik"
              : `Hos ${product.retailerCount} butiker`}
          </p>
        )}
      </div>
    </Link>
  );
}
