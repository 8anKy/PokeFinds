import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import {
  LISTING_KIND_KEYS,
  LISTING_KIND_VARIANTS,
  LISTING_STATUS_KEYS,
  LISTING_STATUS_VARIANTS,
} from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/ui/safe-image";
import { IconCards, IconExternalLink } from "@/components/ui/icons";
import type { ThreadDetail } from "@/services/community";

/**
 * Annonsrutan i en köp/sälj/byt-tråd: typ, pris, skick, status, Tradera-länk
 * och den kopplade katalogprodukten med vårt marknadspris bredvid det begärda.
 * ⛔ Marknadspriset är `Product.lowestPriceOre` — "–" när vi inte vet, aldrig 0 kr.
 */
export function ListingCard({ post }: { post: ThreadDetail }) {
  const t = useTranslations("Forum");
  const tCond = useTranslations("Condition");
  if (!post.listingKind) return null;
  const status = post.listingStatus ?? "ACTIVE";
  const inactive = status !== "ACTIVE";
  const showPrice = post.priceOre != null && post.priceOre > 0;

  return (
    <section
      aria-label={t("listing")}
      className={cn(
        "card-surface rounded-xl p-4",
        inactive && "opacity-70 [&_img]:grayscale"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>
          {t(LISTING_KIND_KEYS[post.listingKind])}
        </Badge>
        <Badge variant={LISTING_STATUS_VARIANTS[status]}>{t(LISTING_STATUS_KEYS[status])}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {showPrice && (
          <div>
            <dt className="text-xs text-ink-faint">{t("price")}</dt>
            <dd className="font-display text-xl font-semibold text-holo-cyan">
              {formatPrice(post.priceOre)}
            </dd>
          </div>
        )}
        {post.condition && (
          <div>
            <dt className="text-xs text-ink-faint">{t("condition")}</dt>
            <dd className="font-medium text-ink">
              {tCond.has(post.condition) ? tCond(post.condition) : post.condition}
            </dd>
          </div>
        )}
      </dl>

      {post.traderaUrl && (
        <a
          href={post.traderaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-holo-cyan hover:underline"
        >
          {t("traderaLink")}
          <IconExternalLink size={14} aria-hidden="true" />
        </a>
      )}

      {post.product && (
        <Link
          href={`/produkter/${post.product.slug}`}
          className="mt-4 flex items-center gap-3 rounded-lg border border-surface-border p-2.5 transition-colors hover:bg-surface-overlay/50"
        >
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-overlay">
            <SafeImage
              src={post.product.imageUrl}
              alt=""
              className="h-full w-full object-contain p-1"
              fallback={<IconCards size={20} className="text-ink-faint" />}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-faint">{t("linkedProduct")}</p>
            <p className="truncate text-sm font-medium text-ink">{post.product.title}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {t("marketPrice")}:{" "}
              <span className="font-semibold text-ink">
                {formatPrice(
                  post.product.lowestPriceOre != null && post.product.lowestPriceOre > 0
                    ? post.product.lowestPriceOre
                    : null
                )}
              </span>
            </p>
          </div>
        </Link>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">{t("marketplaceNotice")}</p>
    </section>
  );
}
