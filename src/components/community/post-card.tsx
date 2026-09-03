/* eslint-disable @next/next/no-img-element */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import {
  LISTING_KIND_KEYS,
  LISTING_KIND_VARIANTS,
  LISTING_STATUS_KEYS,
  POST_CATEGORY_VARIANTS,
} from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { IconHeart, IconMessage } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import { RelativeTime } from "./relative-time";

/**
 * En tråd i listan. Ingen "use client" — renderas som klient när den ligger i
 * ThreadList och som server i andra träd. Sålda/avslutade annonser tonas ner
 * men försvinner inte: tråden är fortfarande en sann historia.
 */
export function PostCard({
  post,
  showGroup = true,
  hrefBase = "/forum/t",
}: {
  post: FeedItem;
  showGroup?: boolean;
  hrefBase?: string;
}) {
  const t = useTranslations("Forum");
  const tCat = useTranslations("PostCategory");
  const muted = post.listingStatus === "SOLD" || post.listingStatus === "CLOSED";
  const thumb = post.images[0]?.url ?? null;

  return (
    <li>
      <Link
        href={`${hrefBase}/${post.id}`}
        className={cn(
          "card-surface block rounded-xl p-3.5 transition-colors hover:bg-surface-overlay/50",
          muted && "opacity-60"
        )}
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {/* Gruppnamnet utan emoji — ägarbeslut 2026-09-03 ("för många emojis"). */}
              {showGroup && post.group && (
                <span className="text-ink-muted">{post.group.name}</span>
              )}
              {post.listingKind && (
                <Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>
                  {t(LISTING_KIND_KEYS[post.listingKind])}
                </Badge>
              )}
              {muted && post.listingStatus && (
                <Badge>{t(LISTING_STATUS_KEYS[post.listingStatus])}</Badge>
              )}
              {!post.group && post.category && (
                <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>
                  {tCat(post.category)}
                </Badge>
              )}
            </div>
            <h3 className="mt-1.5 line-clamp-2 font-display text-base font-semibold leading-snug text-ink">
              {post.title}
            </h3>
            {post.excerpt && (
              <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{post.excerpt}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
              {post.priceOre != null && post.priceOre > 0 && (
                <span className="font-semibold text-holo-cyan">{formatPrice(post.priceOre)}</span>
              )}
              <span className="max-w-[10rem] truncate font-medium text-ink-muted">
                {post.user.name}
              </span>
              <RelativeTime date={post.lastActivityAt} />
              <span className="inline-flex items-center gap-1 tabular-nums">
                <IconHeart size={13} aria-hidden="true" />
                {post.likeCount}
                <span className="sr-only">{t("likes")}</span>
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <IconMessage size={13} aria-hidden="true" />
                {post.commentCount}
                <span className="sr-only">{t("replies")}</span>
              </span>
            </div>
          </div>
          {thumb && (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-20 w-20 shrink-0 rounded-lg bg-surface-overlay object-cover"
            />
          )}
        </div>
      </Link>
    </li>
  );
}
