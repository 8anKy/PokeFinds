import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { productDisplayName, productMetaLabel } from "@/lib/product-display";
import { PriceChange } from "@/components/ui/price-change";
import { StockBadge } from "@/components/ui/badge";
import { SafeImage } from "@/components/ui/safe-image";
import { CollectionQuickAdd } from "@/components/features/collection-quick-add";
import { WatchBell } from "@/components/features/watch-bell";
import { isSealedCategory } from "@/lib/product-category";
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
    /** Utan id renderas ingen "+"-knapp (t.ex. liknande-produkter som saknar id). */
    id?: string;
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
  const tProduct = useTranslations("Product");
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
      {/* Bild eller kategoriikon som placeholder. Bildbrunnen är SVART som resten
          av kortet — `surface-overlay` lyste som en grå ruta på den svarta ytan.
          KVADRATISK, inte 4:3 (2026-07-29): produkterna är stående (boostrar, boxar,
          kort) så den liggande brunnen kapade dem på höjden och lämnade tomma
          sidokanter. Kvadrat + mindre luft (p-3 → p-2) ger ~50 % större motiv utan
          att kortet växer i bredd. Föregående mått finns i taggen `kortlayout-v1`. */}
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-surface">
        {product.dealPercent != null && product.dealPercent > 0 && (
          <span className="absolute left-2 top-2 z-10 rounded-md bg-holo-cyan px-1.5 py-0.5 text-[11px] font-bold text-surface shadow">
            −{product.dealPercent}%
          </span>
        )}
        {/* ratio="square" följer BRUNNEN, inte motivet: ett 5:7-kort och en
            kvadratisk sealed-box skalas båda in i samma kvadrat med
            `object-contain`, så det är kvadraten webbläsaren ska reservera.
            Brunnens `aspect-square` gör redan det jobbet (bilden ärver `h-full
            w-full` ur en ruta med definitiv höjd) — kvoten här är bältet till
            hängslet: tas `h-full` bort, eller renderas bilden någon gång utan
            brunn, står rutan kvar och rutnätet slutar hoppa på 4G. */}
        <SafeImage
          src={product.imageUrl}
          alt={product.title}
          ratio="square"
          className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
          fallback={
            <div
              className="flex h-full w-full items-center justify-center text-ink-faint"
              aria-hidden="true"
            >
              <CategoryIcon size={40} />
            </div>
          }
        />
        {/* Restock-klocka, övre HÖGRA hörnet (fyndmärket äger det vänstra).
            BARA sealed: singlar och tillbehör säljs av Cardmarket/Tradera och
            ingår aldrig i restock-skanningen, så en klocka där hade lovat larm
            som aldrig kan komma. Utan id finns ingen produkt att bevaka. */}
        {product.id && isSealedCategory(product.category) && (
          <WatchBell
            productId={product.id}
            productTitle={product.title}
            setId={product.setId}
            setName={product.setName}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        {/* Bara det officiella namnet — set och nummer får egna rader nedan. */}
        <h3 className="line-clamp-2 min-h-[2.1rem] text-[12px] font-semibold leading-snug tracking-[-0.01em] text-ink transition-colors group-hover:text-holo-cyan">
          <Link
            href={`/produkter/${product.slug}`}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {name}
          </Link>
        </h3>

        {/* Set (klickbart → slår på katalogfiltret) + kortnummer/variant. Dämpad,
            inte turkos: i ett rutnät drog sju turkosa setnamn blicken från priset. */}
        {(product.setName || meta) && (
          <div className="mt-1 min-w-0">
            {product.setName &&
              (product.setId ? (
                <Link
                  href={`/produkter?set=${encodeURIComponent(product.setId)}`}
                  title={tProduct("filterBySet", { set: product.setName })}
                  className="relative z-10 block truncate text-[10.5px] text-ink-faint underline-offset-2 transition-colors hover:text-holo-cyan hover:underline focus-visible:text-holo-cyan focus-visible:underline focus-visible:outline-none"
                >
                  {product.setName}
                </Link>
              ) : (
                <p className="truncate text-[10.5px] text-ink-faint">{product.setName}</p>
              ))}
            {/* Två rader: "Special Illustration Rare · 199/165" ryms inte på en i ett
                171 px-kort. Prisblocket bottenankras ändå, så en extra rad flyttar
                inget. Full text i title för de fall även två rader kapar. */}
            {meta && (
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-faint" title={meta}>
                {meta}
              </p>
            )}
          </div>
        )}

        {/* Prisblocket bottenankras (mt-auto) och håller SAMMA höjd på alla kort:
            raderna reserveras även när de är tomma. Annars hamnade prisraden på
            olika höjd i samma rutnätsrad beroende på om kortet hade butiksantal. */}
        <div className="mt-auto flex flex-col gap-1.5 pt-2.5">
          {/* Pris och trend på SAMMA rad, lagerstatus och "+" på nästa.
              `whitespace-nowrap`: utan den bröts ett femsiffrigt pris över TRE
              rader i ett 171px-kort ("13 / 712,50 / kr"). `flex-wrap` låter i
              stället trenden falla ner på egen rad i just de fallen — hellre en
              extra rad än ett sönderbrutet pris. Blocket är bottenankrat, så
              lager-/"+"-raden ligger kvar i linje med grannkorten. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p
              data-price
              className="whitespace-nowrap font-display text-[17px] font-bold leading-tight tracking-tight text-ink"
            >
              {formatPrice(product.lowestPrice)}
            </p>
            {product.priceChange7d != null && (
              <PriceChange
                percent={product.priceChange7d}
                className="shrink-0 text-[11px]"
                hideIcon
              />
            )}
          </div>
          <div className="flex min-h-[1.875rem] items-center justify-between gap-2">
            {product.stockStatus ? (
              <StockBadge stockStatus={product.stockStatus} />
            ) : (
              <span />
            )}
            {product.id && (
              <CollectionQuickAdd productId={product.id} estimatedValue={product.lowestPrice} />
            )}
          </div>
          {product.dealListingTitle && (
            <p className="truncate text-[11px] leading-4 text-ink-faint" title={product.dealListingTitle}>
              Tradera: {product.dealListingTitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
