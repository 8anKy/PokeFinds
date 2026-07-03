import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatPrice, formatRelative } from "@/lib/format";
import { computeCollectionValue } from "@/services/collection";
import { POST_CATEGORY_VARIANTS } from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconHeart, IconMessage, IconSparkle } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Profile" });
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { name: true },
  });
  return { title: user ? t("metaSuffix", { name: user.name }) : t("metaNotFound") };
}

export default async function ProfilePage({ params }: { params: { locale: string; id: string } }) {
  const t = await getTranslations("Profile");
  const tPost = await getTranslations("PostCategory");
  const [session, user] = await Promise.all([
    auth(),
    prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        bio: true,
        reputationScore: true,
        isPublicCollection: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
    }),
  ]);
  if (!user) notFound();

  const isOwnProfile = session?.user?.id === user.id;

  const [recentPosts, collection] = await Promise.all([
    prisma.communityPost.findMany({
      where: { userId: user.id, isHidden: false },
      select: {
        id: true,
        title: true,
        category: true,
        createdAt: true,
        _count: { select: { likes: true, comments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    user.isPublicCollection || isOwnProfile ? computeCollectionValue(user.id) : Promise.resolve(null),
  ]);

  // Enkla utmärkelser
  const badges: { label: string; variant: "holo" | "info" | "success" }[] = [];
  if (user.reputationScore > 100) badges.push({ label: t("badgeVeteran"), variant: "holo" });
  if (user.isPublicCollection) badges.push({ label: t("badgeCollector"), variant: "info" });
  if (user._count.posts > 10) badges.push({ label: t("badgeActive"), variant: "success" });

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      {/* Profilhuvud */}
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={t("avatarAlt", { name: user.name })}
            className="h-20 w-20 rounded-full border border-surface-border object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-holo-gradient font-display text-2xl font-bold text-surface"
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink">{user.name}</h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-muted sm:justify-start">
            <span className="inline-flex items-center gap-1.5">
              <IconSparkle size={15} className="text-holo-gold" />
              <span className="tabular-nums">{user.reputationScore}</span> {t("reputation")}
            </span>
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <span>{t("memberSince", { date: formatDate(user.createdAt) })}</span>
          </p>
          {badges.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant}>
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {user.bio && <p className="mt-6 text-sm leading-relaxed text-ink-muted">{user.bio}</p>}

      {/* Offentlig samling */}
      {collection && (user.isPublicCollection || isOwnProfile) && (
        <Card className="mt-8">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("collectionTitle")}</CardTitle>
            {isOwnProfile ? (
              <span className="font-display text-lg font-bold text-holo-cyan">
                {formatPrice(collection.totalValue)}
              </span>
            ) : (
              <span className="text-sm text-ink-faint">{t("itemsCount", { count: collection.itemCount })}</span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {collection.topItems.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noItems")}
              </p>
            ) : (
              <ol className="divide-y divide-surface-border">
                {collection.topItems.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-holo-cyan/10 text-xs font-bold text-holo-cyan">
                      {index + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {item.name}
                    </p>
                    <span className="shrink-0 text-xs text-ink-muted">{t("pieces", { count: item.quantity })}</span>
                    {isOwnProfile && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                        {formatPrice(item.totalValue)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Senaste inlägg */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{t("recentPosts")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentPosts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              {t("noPosts", { name: user.name })}
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/community/${post.id}`}
                    className="block px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>
                        {tPost(post.category)}
                      </Badge>
                      <span className="text-xs text-ink-faint">
                        {formatRelative(post.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-ink">{post.title}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1">
                        <IconHeart size={13} />
                        <span className="tabular-nums">{post._count.likes}</span>
                        <span className="sr-only">{t("likes")}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <IconMessage size={13} />
                        <span className="tabular-nums">{post._count.comments}</span>
                        <span className="sr-only">{t("comments")}</span>
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
