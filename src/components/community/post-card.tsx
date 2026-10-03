/* eslint-disable @next/next/no-img-element */
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { localizeGroupName } from "@/lib/community-group-i18n";
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
import { StoreReportSummary } from "./store-report-summary";
import { FeedActions } from "./feed-actions";
import type { useForumViewer } from "./use-forum-viewer";

/**
 * En tråd i listan. Ingen "use client" — renderas som klient när den ligger i
 * ThreadList och som server i andra träd. Sålda/avslutade annonser tonas ner
 * men försvinner inte: tråden är fortfarande en sann historia.
 */
export function PostCard({
  post,
  showGroup = true,
  hrefBase = "/forum/t",
  visual = false,
  personal,
}: {
  post: FeedItem;
  showGroup?: boolean;
  hrefBase?: string;
  visual?: boolean;
  personal?: ReturnType<typeof useForumViewer>;
}) {
  const t = useTranslations("Forum");
  const tCat = useTranslations("PostCategory");
  const tGroups = useTranslations("ForumGroups");
  const muted = post.listingStatus === "SOLD" || post.listingStatus === "CLOSED";
  const thumb = post.images[0]?.url ?? null;

  if (visual) return <li className="card-surface overflow-hidden rounded-xl">
    <Link href={`/profil/${post.user.id}`} className="flex items-center gap-3 px-4 pt-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-overlay text-sm text-ink">{post.user.name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{post.user.name}</span><span className="text-xs text-ink-muted"><RelativeTime date={post.createdAt} /></span></span>
    </Link>
    <Link href={`${hrefBase}/${post.id}`} className="block space-y-3 p-4">
      {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" className="max-h-80 w-full rounded-lg bg-surface-overlay object-contain" />}
      {showGroup && post.group && <p className="text-xs text-ink-muted">{localizeGroupName(post.group.slug, post.group.name, tGroups)}</p>}
      <h2 className="font-display text-lg font-semibold text-ink">{post.title}</h2>
      {post.excerpt && <p className="whitespace-pre-line text-sm text-ink-muted">{post.excerpt}</p>}
      {post.priceOre != null && post.priceOre > 0 && <p className="font-medium text-holo-cyan">{formatPrice(post.priceOre)}</p>}
      {post.listingStatus && <Badge>{t(LISTING_STATUS_KEYS[post.listingStatus])}</Badge>}
      {post.storeReport && <StoreReportSummary report={post.storeReport} linked={false} />}
    </Link>
    {personal && <FeedActions post={post} personal={personal} href={`${hrefBase}/${post.id}`} />}
  </li>;

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
                <span className="text-ink-muted">
                  {localizeGroupName(post.group.slug, post.group.name, tGroups)}
                </span>
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
      {post.storeReport && <StoreReportSummary report={post.storeReport} />}
    </li>
  );
}
