import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
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
import { RelativeTime } from "@/components/community/relative-time";
import { ImageGallery } from "@/components/community/image-gallery";
import { ListingCard } from "@/components/community/listing-card";
import { ThreadActions } from "@/components/community/thread-actions";
import { Replies } from "@/components/community/replies";
import { getPost, listComments } from "@/services/community";

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
  const [t, tCat, locale] = await Promise.all([
    getTranslations("Forum"),
    getTranslations("PostCategory"),
    getLocale(),
  ]);

  let post;
  let comments;
  try {
    [post, comments] = await Promise.all([getPost(params.id), listComments(params.id)]);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }

  const memberSince = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(post.user.memberSince)
  );
  const initial = post.user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto w-full max-w-3xl px-2.5 py-6 sm:px-6">
      <Link
        href={post.group ? `/forum/g/${post.group.slug}` : "/forum"}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-holo-cyan"
      >
        <IconChevronLeft size={16} />
        {post.group ? post.group.name : t("h1")}
      </Link>

      <article className="mt-3 space-y-6">
        <header>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {post.group && (
              <Link
                href={`/forum/g/${post.group.slug}`}
                className="inline-flex items-center gap-1 rounded-full border border-surface-border px-2.5 py-0.5 font-medium text-ink-muted hover:text-holo-cyan"
              >
                {post.group.emoji && <span aria-hidden="true">{post.group.emoji}</span>}
                {post.group.name}
              </Link>
            )}
            {post.listingKind && (
              <Badge variant={LISTING_KIND_VARIANTS[post.listingKind]}>
                {t(LISTING_KIND_KEYS[post.listingKind])}
              </Badge>
            )}
            {post.category && (
              <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>{tCat(post.category)}</Badge>
            )}
          </div>

          <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
            {post.title}
          </h1>

          <div className="mt-4 flex items-start gap-3">
            <Link
              href={`/profil/${post.user.id}`}
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
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <Link
                  href={`/profil/${post.user.id}`}
                  className="font-semibold text-ink hover:text-holo-cyan"
                >
                  {post.user.name}
                </Link>
                <span className="text-xs text-ink-faint">
                  {t("memberSince", { date: memberSince })}
                </span>
                <span className="text-xs text-ink-faint" aria-hidden="true">
                  ·
                </span>
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

        <div className="max-w-prose whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
          {post.content}
        </div>

        {post.images.length > 0 && <ImageGallery images={post.images} />}

        {post.listingKind && <ListingCard post={post} />}

        <ThreadActions
          postId={post.id}
          authorId={post.user.id}
          initialLikeCount={post.likeCount}
          listingKind={post.listingKind}
          listingStatus={post.listingStatus}
          isMarketplace={post.group?.isMarketplace ?? false}
        />

        <hr className="border-surface-border" />

        <Replies postId={post.id} initial={comments} />
      </article>
    </div>
  );
}
