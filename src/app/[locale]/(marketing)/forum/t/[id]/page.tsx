import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/db";
import { alternatesFor } from "@/lib/canonical";
import { ServiceError } from "@/lib/errors";
import {
  LISTING_KIND_KEYS,
  LISTING_KIND_VARIANTS,
  POST_CATEGORY_VARIANTS,
} from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/ui/safe-image";
import { IconChevronLeft } from "@/components/ui/icons";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { SwipeBack } from "@/components/ui/swipe-back";
import { RelativeTime } from "@/components/community/relative-time";
import { FeedMedia } from "@/components/community/feed-media";
import { ListingCard } from "@/components/community/listing-card";
import { ThreadActions } from "@/components/community/thread-actions";
import { Replies } from "@/components/community/replies";
import { getPost, listComments } from "@/services/community";
import { StoreReportSummary } from "@/components/community/store-report-summary";

export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; id: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Forum" });
  // Smal fråga med flit — sidkroppen gör den tunga läsningen.
  const post = await prisma.communityPost.findUnique({
    where: { id: params.id },
    select: { title: true, content: true, isHidden: true },
  });
  if (!post || post.isHidden) return { title: t("threadNotFound") };
  const description = post.content.replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    title: post.title,
    description,
    alternates: alternatesFor(params.locale, `/forum/t/${params.id}`),
  };
}

export default async function ThreadPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const [t, tCat] = await Promise.all([
    getTranslations("Forum"),
    getTranslations("PostCategory"),
  ]);

  let post;
  let comments;
  try {
    [post, comments] = await Promise.all([getPost(params.id), listComments(params.id)]);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }

  const initial = post.user.name.trim().charAt(0).toUpperCase() || "?";

  const backHref = "/forum";
  const backLabel = t("h1");
  const localized = (href: string) => `/${params.locale}${href}`;
  // Bara etiketter som säger något om TRÅDEN. Gruppen står redan i
  // tillbaka-länken rakt ovanför — som chip också blev det två "Allmänt" på
  // två rader (ägaren 2026-09-05: "one is enough").
  const hasBadges = post.listingKind != null || post.category != null;

  return (
    <SwipeBack fallback={backHref} coverViewport viewportInset="safe">
      <div className="mx-auto w-full max-w-xl px-2.5 py-4 sm:px-6">
      {/* Mobil: appens bakåtcirkel + gruppen som titel (tråden är rubriken nedanför).
          Desktop: textlänken som förr — där finns webbens huvud. */}
      <SubpageHeader href={backHref} title={t("replies")} mobileOnly />
      <a
        href={localized(backHref)}
        className="hidden items-center gap-1 text-sm text-ink-muted hover:text-holo-cyan lg:inline-flex"
      >
        <IconChevronLeft size={16} />
        {backLabel}
      </a>

      <article className="space-y-6 lg:mt-3">
        <header>
          {hasBadges && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {post.listingKind && (
                <Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>
                  {t(LISTING_KIND_KEYS[post.listingKind])}
                </Badge>
              )}
              {post.category && (
                <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>{tCat(post.category)}</Badge>
              )}
            </div>
          )}

          <div className="mt-4 flex items-start gap-3">
            <a
              href={localized(`/profil/${post.user.id}`)}
              className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-surface-border bg-surface-overlay font-display text-base font-semibold text-holo-cyan"
              aria-hidden="true"
              tabIndex={-1}
            >
              <SafeImage
                src={post.user.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                fallback={<span>{initial}</span>}
              />
            </a>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <a
                  href={localized(`/profil/${post.user.id}`)}
                  className="font-semibold text-ink hover:text-holo-cyan"
                >
                  {post.user.name}
                </a>
                <RelativeTime date={post.createdAt} className="text-xs text-ink-faint" />
              </div>
              {(post.user.traderaLinked || post.user.discordLinked || post.user.salesCount > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {post.user.traderaLinked && <Badge variant="info">{t("trustTradera")}</Badge>}
                  {post.user.discordLinked && <Badge variant="info">{t("trustDiscord")}</Badge>}
                  {post.user.salesCount > 0 && (
                    <Badge variant="success">
                      {t("trustSales", { count: post.user.salesCount })}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {post.images.length > 0 && <div className="-mx-2.5 sm:mx-0"><FeedMedia images={post.images} /></div>}

        <div className="space-y-1 text-sm leading-relaxed text-ink">
          <h1 className="font-semibold">{post.title}</h1>
          <p className="whitespace-pre-wrap break-words">{post.content}</p>
        </div>

        {post.listingKind && <ListingCard post={post} />}
        {post.storeReport && <StoreReportSummary report={post.storeReport} />}

        <ThreadActions
          postId={post.id}
          authorId={post.user.id}
          initialLikeCount={post.likeCount}
          listingKind={post.listingKind}
          listingStatus={post.listingStatus}
          isMarketplace={post.group?.isMarketplace ?? false}
        />

        <hr className="border-surface-border" />

        <div id="comments" className="scroll-mt-24"><Replies postId={post.id} initial={comments} /></div>
      </article>
      </div>
    </SwipeBack>
  );
}
