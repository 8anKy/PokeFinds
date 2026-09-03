/**
 * Forumtjänster: flöde, trådar, svar, likes, sparade, rapporter, moderering.
 *
 * DTO:erna här är JSON-säkra (datum som ISO-strängar) med flit: samma form går
 * ut ur API-rutterna OCH in i klientkomponenterna från ISR-sidorna, så det finns
 * exakt en definition av "en tråd i listan". Bild-URL:er SIGNERAS här
 * (`imageUrls`) och lagras aldrig — nyckeln är sanningen, URL:en är färskvara.
 */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { hasRole } from "@/lib/auth";
import { imageUrls } from "@/lib/object-storage";
import { canSetListingStatus } from "@/lib/listing-rules";
import type {
  ListingKind,
  ListingStatus,
  PostCategory,
  Prisma,
  ReportStatus,
  Role,
} from "@prisma/client";

const POST_AUTHOR_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  reputationScore: true,
} as const;

const GROUP_REF_SELECT = {
  id: true,
  slug: true,
  name: true,
  emoji: true,
  isMarketplace: true,
} as const;

/**
 * Katalogprodukten en annons pekar på. `lowestPriceOre` är den denormaliserade
 * "lägsta pris"-cachen (recomputeProductPriceCache) — billigaste möjliga
 * "marknadspris" utan en enda offer-läsning. null visas som "–".
 */
const PRODUCT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  imageUrl: true,
  lowestPriceOre: true,
} as const;

const IMAGE_SELECT = { key: true, width: true, height: true } as const;

export interface ForumAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
  reputationScore: number;
}

export interface ForumGroupRef {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  isMarketplace: boolean;
}

export interface ForumImage {
  key: string;
  /** Signerad läs-URL (7 dygn). null när lagringen är avstängd. */
  url: string | null;
  width: number | null;
  height: number | null;
}

export interface ForumProductSummary {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  lowestPriceOre: number | null;
}

export interface FeedItem {
  id: string;
  title: string;
  excerpt: string;
  /** Legacy-kategori på trådar från före grupperna. */
  category: PostCategory | null;
  listingKind: ListingKind | null;
  listingStatus: ListingStatus | null;
  priceOre: number | null;
  condition: string | null;
  createdAt: string;
  lastActivityAt: string;
  user: ForumAuthor;
  group: ForumGroupRef | null;
  /** Bara första bilden i listor. */
  images: ForumImage[];
  commentCount: number;
  likeCount: number;
}

export interface ThreadAuthor extends ForumAuthor {
  memberSince: string;
  traderaLinked: boolean;
  discordLinked: boolean;
  salesCount: number;
}

export interface ThreadDetail extends Omit<FeedItem, "excerpt" | "user"> {
  content: string;
  traderaUrl: string | null;
  productId: string | null;
  product: ForumProductSummary | null;
  user: ThreadAuthor;
}

export interface CommentDto {
  id: string;
  content: string;
  createdAt: string;
  user: ForumAuthor;
}

export interface FeedParams {
  groupSlug?: string;
  /** Bara en viss författares trådar (profilens Inlägg-flik). */
  authorId?: string;
  kind?: ListingKind;
  /**
   * Annonsstatus. Utelämnad = "det som är aktuellt": vanliga trådar (null) +
   * aktiva annonser. Sålda/avslutade göms ur flödet men finns kvar på sin URL.
   */
  status?: ListingStatus | "all";
  page: number;
  pageSize: number;
}

const FEED_INCLUDE = {
  user: { select: POST_AUTHOR_SELECT },
  group: { select: GROUP_REF_SELECT },
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: IMAGE_SELECT },
  _count: { select: { comments: true, likes: true } },
} satisfies Prisma.CommunityPostInclude;

type FeedRow = Prisma.CommunityPostGetPayload<{ include: typeof FEED_INCLUDE }>;

function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 180 ? flat : `${flat.slice(0, 179)}…`;
}

async function signImages(
  images: { key: string; width: number | null; height: number | null }[]
): Promise<ForumImage[]> {
  if (images.length === 0) return [];
  const urls = await imageUrls(images.map((i) => i.key));
  return images.map((img, i) => ({ ...img, url: urls[i] ?? null }));
}

async function toFeedItems(rows: FeedRow[]): Promise<FeedItem[]> {
  // EN signeringsrunda för hela sidan (ren kryptografi, men håll den samlad).
  const flat = rows.flatMap((r) => r.images);
  const signed = await signImages(flat);
  let cursor = 0;
  return rows.map((r) => {
    const images = signed.slice(cursor, cursor + r.images.length);
    cursor += r.images.length;
    return {
      id: r.id,
      title: r.title,
      excerpt: excerptOf(r.content),
      category: r.category,
      listingKind: r.listingKind,
      listingStatus: r.listingStatus,
      priceOre: r.priceOre,
      condition: r.condition,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.lastActivityAt.toISOString(),
      user: r.user,
      group: r.group,
      images,
      commentCount: r._count.comments,
      likeCount: r._count.likes,
    };
  });
}

export function buildFeedWhere(
  params: Pick<FeedParams, "groupSlug" | "authorId" | "kind" | "status">
) {
  const where: Prisma.CommunityPostWhereInput = { isHidden: false };
  if (params.groupSlug) where.group = { slug: params.groupSlug };
  if (params.authorId) where.userId = params.authorId;
  if (params.kind) where.listingKind = params.kind;
  if (params.status === "all") {
    // inget statusfilter
  } else if (params.status) {
    where.listingStatus = params.status;
  } else {
    where.OR = [{ listingStatus: null }, { listingStatus: "ACTIVE" }];
  }
  return where;
}

export async function getFeed(params: FeedParams) {
  const { page, pageSize } = params;
  const where = buildFeedWhere(params);

  const [rows, total] = await prisma.$transaction([
    prisma.communityPost.findMany({
      where,
      include: FEED_INCLUDE,
      orderBy: { lastActivityAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.communityPost.count({ where }),
  ]);

  const items = await toFeedItems(rows);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Betraktarens SPARADE trådar, senast sparad först — dit Spara-knappen leder
 * (/forum/sparade). Gömda trådar faller bort men raden ligger kvar; dyker
 * tråden upp igen är den sparad som förut.
 */
export async function getSavedFeed(userId: string, page: number, pageSize: number) {
  const where = { userId, post: { isHidden: false } } as const;
  const [rows, total] = await prisma.$transaction([
    prisma.savedPost.findMany({
      where,
      include: { post: { include: FEED_INCLUDE } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.savedPost.count({ where }),
  ]);
  const items = await toFeedItems(rows.map((r) => r.post));
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Betraktarens GILLADE trådar, senast gillad först (Gillade-fliken på /forum/sparade). */
export async function getLikedFeed(userId: string, page: number, pageSize: number) {
  const where = { userId, post: { isHidden: false } } as const;
  const [rows, total] = await prisma.$transaction([
    prisma.like.findMany({
      where,
      include: { post: { include: FEED_INCLUDE } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.like.count({ where }),
  ]);
  const items = await toFeedItems(rows.map((r) => r.post));
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getPost(postId: string): Promise<ThreadDetail> {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    include: {
      user: {
        select: {
          ...POST_AUTHOR_SELECT,
          createdAt: true,
          traderaUserId: true,
          discordUserId: true,
          _count: { select: { sales: true } },
        },
      },
      group: { select: GROUP_REF_SELECT },
      product: { select: PRODUCT_SUMMARY_SELECT },
      images: { orderBy: { sortOrder: "asc" }, select: IMAGE_SELECT },
      _count: { select: { comments: true, likes: true } },
    },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Tråden hittades inte.");

  const images = await signImages(post.images);
  const { _count: salesCount, traderaUserId, discordUserId, createdAt, ...author } = post.user;
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    listingKind: post.listingKind,
    listingStatus: post.listingStatus,
    priceOre: post.priceOre,
    condition: post.condition,
    traderaUrl: post.traderaUrl,
    productId: post.productId,
    createdAt: post.createdAt.toISOString(),
    lastActivityAt: post.lastActivityAt.toISOString(),
    user: {
      ...author,
      memberSince: createdAt.toISOString(),
      traderaLinked: traderaUserId != null,
      discordLinked: discordUserId != null,
      salesCount: salesCount.sales,
    },
    group: post.group,
    product: post.product,
    images,
    commentCount: post._count.comments,
    likeCount: post._count.likes,
  };
}

export interface CreatePostInput {
  groupId: string;
  title: string;
  content: string;
  images: { key: string; width?: number | null; height?: number | null }[];
  listingKind?: ListingKind | null;
  priceOre?: number | null;
  condition?: string | null;
  productId?: string | null;
  traderaUrl?: string | null;
}

export async function createPost(userId: string, input: CreatePostInput) {
  const { images, groupId, listingKind, ...rest } = input;
  return prisma.communityPost.create({
    data: {
      userId,
      groupId,
      ...rest,
      listingKind: listingKind ?? null,
      // Annonsstatus följer annonstypen: en annons föds aktiv, en vanlig tråd
      // har ingen status alls (null håller den utanför marknadsfiltren).
      listingStatus: listingKind ? "ACTIVE" : null,
      images: {
        create: images.map((img, i) => ({
          key: img.key,
          width: img.width ?? null,
          height: img.height ?? null,
          sortOrder: i,
        })),
      },
    },
    include: {
      user: { select: POST_AUTHOR_SELECT },
      group: { select: GROUP_REF_SELECT },
      images: { orderBy: { sortOrder: "asc" }, select: IMAGE_SELECT },
    },
  });
}

/** Ägaren styr sin annons; moderator+ får bara stänga. Se listing-rules. */
export async function setListingStatus(
  postId: string,
  userId: string,
  userRole: Role,
  next: ListingStatus
) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { userId: true, listingKind: true, group: { select: { slug: true } } },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  if (!post.listingKind) throw new ServiceError(400, "Tråden är ingen annons.");
  const allowed = canSetListingStatus({
    isOwner: post.userId === userId,
    isModerator: hasRole(userRole, "MODERATOR"),
    next,
  });
  if (!allowed) throw new ServiceError(403, "Du får inte ändra annonsens status.");
  const updated = await prisma.communityPost.update({
    where: { id: postId },
    data: { listingStatus: next },
    select: { id: true, listingStatus: true },
  });
  return { ...updated, groupSlug: post.group?.slug ?? null };
}

/**
 * Radera tråd – tillåtet för ägaren eller moderator+. Returnerar bildnycklarna
 * så rutten kan städa lagringen EFTER att raden är borta (best effort — en
 * kvarglömd fil är billigare än en tråd som inte går att ta bort).
 */
export async function deletePost(postId: string, userId: string, userRole: Role) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: {
      userId: true,
      images: { select: { key: true } },
      group: { select: { slug: true } },
    },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  if (post.userId !== userId && !hasRole(userRole, "MODERATOR")) {
    throw new ServiceError(403, "Du får inte ta bort den här tråden.");
  }
  await prisma.communityPost.delete({ where: { id: postId } });
  return {
    deleted: true as const,
    imageKeys: post.images.map((i) => i.key),
    groupSlug: post.group?.slug ?? null,
  };
}

function toCommentDto(c: {
  id: string;
  content: string;
  createdAt: Date;
  user: ForumAuthor;
}): CommentDto {
  return { id: c.id, content: c.content, createdAt: c.createdAt.toISOString(), user: c.user };
}

export async function listComments(postId: string): Promise<CommentDto[]> {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Tråden hittades inte.");
  const rows = await prisma.comment.findMany({
    where: { postId, isHidden: false },
    include: { user: { select: POST_AUTHOR_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toCommentDto);
}

/**
 * Nytt svar. Stämplar trådens `lastActivityAt` i SAMMA transaktion — det är
 * den stämpeln som lyfter tråden i flödet. Returnerar också det rutten behöver
 * för push + revalidering utan en extra läsning.
 */
export async function addComment(postId: string, userId: string, content: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true, userId: true, title: true, group: { select: { slug: true } } },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Tråden hittades inte.");
  const [comment] = await prisma.$transaction([
    prisma.comment.create({
      data: { postId, userId, content },
      include: { user: { select: POST_AUTHOR_SELECT } },
    }),
    prisma.communityPost.update({
      where: { id: postId },
      data: { lastActivityAt: new Date() },
      select: { id: true },
    }),
  ]);
  return {
    comment: toCommentDto(comment),
    post: { userId: post.userId, title: post.title, groupSlug: post.group?.slug ?? null },
  };
}

/** Växlar like på en tråd. Returnerar nytt tillstånd + antal. */
export async function toggleLike(postId: string, userId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Tråden hittades inte.");

  const existing = await prisma.like.findUnique({
    where: { postId_userId: { postId, userId } },
  });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
  } else {
    await prisma.like.create({ data: { postId, userId } });
  }
  const likeCount = await prisma.like.count({ where: { postId } });
  return { liked: !existing, likeCount };
}

/** Växlar sparad tråd. */
export async function toggleSave(postId: string, userId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Tråden hittades inte.");

  const existing = await prisma.savedPost.findUnique({
    where: { postId_userId: { postId, userId } },
  });
  if (existing) {
    await prisma.savedPost.delete({ where: { id: existing.id } });
  } else {
    await prisma.savedPost.create({ data: { postId, userId } });
  }
  return { saved: !existing };
}

/** Vad DEN HÄR användaren gillat/sparat bland `postIds` — två små läsningar. */
export async function personalPostState(userId: string, postIds: string[]) {
  if (postIds.length === 0) return { likedIds: [] as string[], savedIds: [] as string[] };
  const [likes, saved] = await prisma.$transaction([
    prisma.like.findMany({ where: { userId, postId: { in: postIds } }, select: { postId: true } }),
    prisma.savedPost.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    }),
  ]);
  return { likedIds: likes.map((l) => l.postId), savedIds: saved.map((s) => s.postId) };
}

export async function reportPost(postId: string, reporterId: string, reason: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  return prisma.report.create({
    data: { postId, reporterId, reason },
  });
}

// ---------- Moderering ----------

export async function hidePost(postId: string, hidden = true) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  return prisma.communityPost.update({
    where: { id: postId },
    data: { isHidden: hidden },
  });
}

export async function resolveReport(
  reportId: string,
  status: ReportStatus,
  opts: { hidePost?: boolean } = {}
) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw new ServiceError(404, "Rapporten hittades inte.");

  const [updated] = await prisma.$transaction([
    prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        resolvedAt: status === "OPEN" ? null : new Date(),
      },
    }),
    ...(opts.hidePost
      ? [
          prisma.communityPost.update({
            where: { id: report.postId },
            data: { isHidden: true },
          }),
        ]
      : []),
  ]);
  return updated;
}
