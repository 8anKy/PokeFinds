"use client";
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
import { FeedMedia } from "./feed-media";
import { FeedActions } from "./feed-actions";
import type { useForumViewer } from "./use-forum-viewer";

/**
 * Samma inlägg i kompakt trådlista eller bildflöde. Bildserien och personliga
 * åtgärder ligger i klienten; servern skickar redan signerade miniatyrer.
 * Sålda/avslutade annonser finns kvar på profil/tråd som sann historik.
 */
export function PostCard({
  post,
  showGroup = true,
  hrefBase = "/forum/t",
  visual = false,
  personal,
  onProfile = false,
}: {
  post: FeedItem;
  showGroup?: boolean;
  hrefBase?: string;
  visual?: boolean;
  personal?: ReturnType<typeof useForumViewer>;
  onProfile?: boolean;
}) {
  const t = useTranslations("Forum");
  const tStores = useTranslations("LocalStores");
  const tCat = useTranslations("PostCategory");
  const tGroups = useTranslations("ForumGroups");
  const muted = post.listingStatus === "SOLD" || post.listingStatus === "CLOSED";
  const thumb = post.images[0]?.url ?? null;
  const profileHref = `/profil/${post.user.id}?inlagg=${post.id}#post-${post.id}`;

  if (visual) return <li id={`post-${post.id}`} className="scroll-mt-24 border-b border-surface-border pb-5">
    <div className="flex items-center justify-between gap-3 px-2.5 py-3 sm:px-0">
      <Link href={`/profil/${post.user.id}`} className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-surface-border bg-surface-overlay text-sm font-semibold text-ink">{post.user.avatarUrl ? <img src={post.user.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : post.user.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{post.user.name}</span>
          <span className="block truncate text-xs text-ink-muted">{post.storeReport ? `${post.storeReport.store.name} · ${post.storeReport.store.city}` : showGroup && post.group ? localizeGroupName(post.group.slug, post.group.name, tGroups) : <RelativeTime date={post.createdAt} />}</span>
        </span>
      </Link>
      <Link href={`${hrefBase}/${post.id}`} className="grid h-10 w-10 shrink-0 place-items-center text-ink-muted" aria-label={tStores("readPost")}><IconMessage size={20} /></Link>
    </div>
    <FeedMedia images={post.images} href={profileHref} lightbox={onProfile} />
    {personal && <FeedActions post={post} personal={personal} href={`${hrefBase}/${post.id}`} />}
    <div className="space-y-2 px-2.5 sm:px-0">
      {onProfile ? <div className="text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold">{post.user.name}</span><span className="font-medium">{post.title}</span>{(post.content || post.excerpt) && <p className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{post.content || post.excerpt}</p>}</div> : <Link href={profileHref} className="block text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold">{post.user.name}</span><span className="font-medium">{post.title}</span>{post.excerpt && <span className="mt-1 block whitespace-pre-line text-ink-muted">{post.excerpt}</span>}</Link>}
      {post.listingKind && <div className="flex items-center gap-2"><Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>{t(LISTING_KIND_KEYS[post.listingKind])}</Badge>{post.priceOre != null && post.priceOre > 0 && <span className="font-medium text-holo-cyan">{formatPrice(post.priceOre)}</span>}{muted && post.listingStatus && <Badge>{t(LISTING_STATUS_KEYS[post.listingStatus])}</Badge>}</div>}
      {post.storeReport && <StoreReportSummary report={post.storeReport} />}
      <Link href={`${hrefBase}/${post.id}`} className="block min-h-8 text-sm text-ink-muted">{t("replies")} · {personal?.state.counts[post.id]?.commentCount ?? post.commentCount}</Link>
      <p className="text-xs text-ink-faint"><RelativeTime date={post.createdAt} /></p>
    </div>
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
