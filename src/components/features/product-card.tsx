import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { productDisplayName, productMetaLabel } from "@/lib/product-display";
import { PriceChange } from "@/components/ui/price-change";
import { StockBadge } from "@/components/ui/badge";
import { SafeImage } from "@/components/ui/safe-image";
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
    // Set + kortnummer visas som egna rader i cellen i stället för i namnet
    // (se src/lib/product-display.ts). Utelämnade → raderna hoppas över.
    setId?: string | null;
    setName?: string | null;
    setTotalCards?: number | null;
    cardName?: string | null;
    cardNumber?: string | null;
    cardRarity?: string | null;
    variantLabel?: string | null;
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
  const name = productDisplayName(product);
  const meta = productMetaLabel(product);

  return (
    // Kortet är en <div>, inte en <a>: set-raden är en EGEN länk och en <a> i en <a>
    // är ogiltig HTML. Produktlänken täcker i stället hela kortet via after:inset-0
    // ("stretched link") och set-länken lyfts över den med relative z-10.
    <div
      className={cn(
        "card-surface group relative flex h-full flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-holo-cyan/40 hover:shadow-glow active:scale-[0.98] focus-within:border-holo-cyan/40 focus-within:ring-2 focus-within:ring-holo-cyan",
        className
      )}
    >
      {/* Bild eller kategoriikon som placeholder */}
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-surface-overlay">
        {product.dealPercent != null && product.dealPercent > 0 && (
          <span className="absolute left-2 top-2 z-10 rounded-md bg-holo-cyan px-1.5 py-0.5 text-[11px] font-bold text-surface shadow">
            −{product.dealPercent}%
          </span>
        )}
        <SafeImage
          src={product.imageUrl}
          alt={product.title}
          className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
          fallback={
            <div
              className="flex h-full w-full items-center justify-center text-ink-faint"
              aria-hidden="true"
            >
              <CategoryIcon size={40} />
            </div>
          }
        />
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          {categoryLabel}
        </p>
        {/* Bara det officiella namnet — set och nummer får egna rader nedan. */}
        <h3 className="mt-2 line-clamp-2 min-h-[2.25rem] text-sm font-medium leading-snug text-ink transition-colors group-hover:text-holo-cyan">
          <Link
            href={`/produkter/${product.slug}`}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {name}
          </Link>
        </h3>

        {/* Set (klickbart → slår på katalogfiltret) + kortnummer/variant. */}
        {(product.setName || meta) && (
          <div className="mt-1 min-w-0">
            {product.setName &&
              (product.setId ? (
                <Link
                  href={`/produkter?set=${encodeURIComponent(product.setId)}`}
                  title={tProduct("filterBySet", { set: product.setName })}
                  className="relative z-10 block truncate text-xs font-medium text-holo-cyan/90 underline-offset-2 transition-colors hover:text-holo-cyan hover:underline focus-visible:text-holo-cyan focus-visible:underline focus-visible:outline-none"
                >
                  {product.setName}
                </Link>
              ) : (
                <p className="truncate text-xs font-medium text-ink-muted">{product.setName}</p>
              ))}
            {/* Två rader: "Special Illustration Rare · 199/165" ryms inte på en i ett
                171 px-kort. Prisblocket bottenankras ändå, så en extra rad flyttar
                inget. Full text i title för de fall även två rader kapar. */}
            {meta && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-faint" title={meta}>
                {meta}
              </p>
            )}
          </div>
        )}

        {/* Prisblocket bottenankras (mt-auto) och håller SAMMA höjd på alla kort:
            raderna reserveras även när de är tomma. Annars hamnade prisraden på
            olika höjd i samma rutnätsrad beroende på om kortet hade butiksantal. */}
        <div className="mt-auto pt-2.5">
          <p data-price className="font-display text-lg font-bold tracking-tight text-ink">
            {formatPrice(product.lowestPrice)}
          </p>
          {/* Konsekvent rad: prisförändring vänster, lagerstatus alltid höger. */}
          <div className="mt-1.5 flex min-h-[1.5rem] items-center justify-between gap-2">
            {product.priceChange7d != null ? (
              <PriceChange percent={product.priceChange7d} className="text-xs" hideIcon />
            ) : (
              <span />
            )}
            {product.stockStatus && (
              <StockBadge stockStatus={product.stockStatus} className="min-w-[4.75rem] justify-center" />
            )}
          </div>

          <p
            className="mt-1.5 min-h-4 truncate text-[11px] leading-4 text-ink-faint"
            title={product.dealListingTitle ?? undefined}
          >
            {product.dealListingTitle
              ? `Tradera: ${product.dealListingTitle}`
              : product.retailerCount != null && product.retailerCount > 0
                ? tProduct("atStores", { count: product.retailerCount })
                : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
