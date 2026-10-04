"use client";
/* eslint-disable @next/next/no-img-element */
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { StoreReportFeedCard } from "./store-report-feed-card";
import { FeedMedia } from "./feed-media";
import { FeedActions } from "./feed-actions";
import { CommentsSheet } from "./comments-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ThreadActions } from "./thread-actions";
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
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const profileHref = `/profil/${post.user.id}?inlagg=${post.id}#post-${post.id}`;

  const report = post.storeReport ?? null;
  // Statusarkets standardtext ("Fanns på hyllan") är ingen kommentar — kortet säger det redan.
  const reportComment = report && post.excerpt && post.excerpt.trim() !== tStores(`observation.${report.observation}`) ? post.excerpt : null;
  const header = (
    <div className="flex items-center justify-between gap-3 px-2.5 py-3 sm:px-0">
      <Link href={`/profil/${post.user.id}`} className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-surface-border bg-surface-overlay text-sm font-semibold text-ink">{post.user.avatarUrl ? <img src={post.user.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : post.user.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{post.user.name}</span>
          <span className="block truncate text-xs text-ink-muted">{report ? tStores("storeReportLabel") : showGroup && post.group ? localizeGroupName(post.group.slug, post.group.name, tGroups) : <RelativeTime date={post.createdAt} />}</span>
        </span>
      </Link>
      <button type="button" onClick={() => setOptionsOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center text-xl text-ink-muted" aria-label={tStores("postOptions")}>···</button>
    </div>
  );
  const sheets = <>
    {commentsOpen && <CommentsSheet postId={post.id} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />}
    {optionsOpen && <BottomSheet open title={tStores("postOptions")} closeLabel={tStores("close")} onClose={() => setOptionsOpen(false)} panelClassName="sm:mx-auto sm:w-full sm:max-w-xl"><div className="pb-6"><ThreadActions postId={post.id} authorId={post.user.id} initialLikeCount={post.likeCount} listingKind={post.listingKind} listingStatus={post.listingStatus} isMarketplace={post.group?.isMarketplace ?? false} /></div></BottomSheet>}
  </>;

  // Butiksrapport (ägarbeslut 2026-10-05): rapportkortet först, medlemmens foton och
  // kommentar efter, gilla/kommentera/rösta LÄNGST NED — inte ovanför innehållet.
  if (visual && report) return <li id={`post-${post.id}`} className="scroll-mt-32 border-b border-surface-border pb-4">
    {header}
    <div className="space-y-3 px-2.5 sm:px-0">
      <StoreReportFeedCard report={report} />
      {reportComment && <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold">{post.user.name}</span>{reportComment}</p>}
    </div>
    {post.images.length > 0 && <div className="mt-3"><FeedMedia images={post.images} href={profileHref} lightbox={onProfile} /></div>}
    <div className="mt-3 px-2.5 sm:px-0">
      {personal
        ? <FeedActions post={post} personal={personal} href={`${hrefBase}/${post.id}`} onComments={() => setCommentsOpen(true)} commentCount={commentCount ?? undefined} />
        : <button type="button" onClick={() => setCommentsOpen(true)} className="block min-h-9 text-sm text-ink-muted">{tStores("viewComments", { count: commentCount ?? post.commentCount })}</button>}
    </div>
    {sheets}
  </li>;

  if (visual) return <li id={`post-${post.id}`} className="scroll-mt-32 border-b border-surface-border pb-5">
    <div className="flex items-center justify-between gap-3 px-2.5 py-3 sm:px-0">
      <Link href={`/profil/${post.user.id}`} className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-surface-border bg-surface-overlay text-sm font-semibold text-ink">{post.user.avatarUrl ? <img src={post.user.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : post.user.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{post.user.name}</span>
          <span className="block truncate text-xs text-ink-muted">{post.storeReport ? `${post.storeReport.store.name} · ${post.storeReport.store.city}` : showGroup && post.group ? localizeGroupName(post.group.slug, post.group.name, tGroups) : <RelativeTime date={post.createdAt} />}</span>
        </span>
      </Link>
      <button type="button" onClick={() => setOptionsOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center text-xl text-ink-muted" aria-label={tStores("postOptions")}>···</button>
    </div>
    <FeedMedia images={post.images} href={profileHref} lightbox={onProfile} />
    {personal && <FeedActions post={post} personal={personal} href={`${hrefBase}/${post.id}`} onComments={() => setCommentsOpen(true)} />}
    <div className="space-y-2 px-2.5 sm:px-0">
      {onProfile ? <div className="text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold">{post.user.name}</span><span className="font-medium">{post.title}</span>{(post.content || post.excerpt) && <p className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{post.content || post.excerpt}</p>}</div> : <Link href={profileHref} className="block text-sm leading-relaxed text-ink"><span className="mr-2 font-semibold">{post.user.name}</span><span className="font-medium">{post.title}</span>{post.excerpt && <span className="mt-1 block whitespace-pre-line text-ink-muted">{post.excerpt}</span>}</Link>}
      {post.listingKind && <div className="flex items-center gap-2"><Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>{t(LISTING_KIND_KEYS[post.listingKind])}</Badge>{post.priceOre != null && post.priceOre > 0 && <span className="font-medium text-holo-cyan">{formatPrice(post.priceOre)}</span>}{muted && post.listingStatus && <Badge>{t(LISTING_STATUS_KEYS[post.listingStatus])}</Badge>}</div>}
      {post.storeReport && <StoreReportSummary report={post.storeReport} />}
      <button type="button" onClick={() => setCommentsOpen(true)} className="block min-h-9 text-sm text-ink-muted">{tStores("viewComments", { count: commentCount ?? personal?.state.counts[post.id]?.commentCount ?? post.commentCount })}</button>
      <p className="text-xs text-ink-faint"><RelativeTime date={post.createdAt} /></p>
    </div>
    {commentsOpen && <CommentsSheet postId={post.id} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />}
    {optionsOpen && <BottomSheet open title={tStores("postOptions")} closeLabel={tStores("close")} onClose={() => setOptionsOpen(false)} panelClassName="sm:mx-auto sm:w-full sm:max-w-xl"><div className="pb-6"><ThreadActions postId={post.id} authorId={post.user.id} initialLikeCount={post.likeCount} listingKind={post.listingKind} listingStatus={post.listingStatus} isMarketplace={post.group?.isMarketplace ?? false} /></div></BottomSheet>}
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
