/**
 * Forumtjänster: flöde, trådar, svar, likes, sparade, rapporter, moderering.
 *
 * DTO:erna här är JSON-säkra (datum som ISO-strängar) med flit: samma form går
 * ut ur API-rutterna OCH in i klientkomponenterna från ISR-sidorna, så det finns
 * exakt en definition av "en tråd i listan". Bild-URL:er SIGNERAS här
 * (`imageUrls`) och lagras aldrig — nyckeln är sanningen, URL:en är färskvara.
 */
import { deleteStoreReportFromDiscord } from "@/lib/discord-store-report";
import { REPORT_FRESH_HOURS, reportIsFresh } from "@/lib/community-stores";
import { FRESH_BUCKET_MS } from "@/lib/community-feed-modes";
import { tallyVotes, type StoreReportVote, type VoteTally } from "@/lib/store-report-votes";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { hasRole } from "@/lib/auth";
import { imageUrls } from "@/lib/object-storage";
import { canSetListingStatus } from "@/lib/listing-rules";
import { cachedRead } from "@/lib/cache";
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

const IMAGE_SELECT = { key: true, thumbKey: true, width: true, height: true } as const;

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
  /** Full bildtext på profilen; listor kan fortsatt använda det korta utdraget. */
  content?: string;
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
  /** Miniatyrer för bildserien; klienten laddar bara den synliga bilden. */
  images: ForumImage[];
  commentCount: number;
  likeCount: number;
  storeReport?: StoreReportDto | null;
}

export interface StoreReportDto {
  store: { id: string; name: string; address: string; city: string };
  productLabel: string;
  productSlug: string | null;
  priceOre: number | null;
  currency: string;
  observation: string;
  observedAt: string;
  nearbyAtSubmit: boolean;
  /** Andra medlemmars röster: stämmer fortfarande / inte längre (lib/store-report-votes.ts). */
  confirmCount: number;
  disputeCount: number;
  lastVote: VoteTally["lastVote"];
  /** Katalogens bild för produkten (relativ /api/cm-image/… eller absolut). */
  productImageUrl: string | null;
}

const STORE_REPORT_INCLUDE = { include: {
  store: { select: { id: true, name: true, address: true, city: true } },
  // Rösterna är få per rapport (bara under 12 h) — räkna i minnet i stället för två aggregat.
  confirmations: { select: { kind: true, createdAt: true, userId: true } },
} } as const;

type StoreReportRow = {
  store: StoreReportDto["store"]; productLabel: string; productSlug: string | null; priceOre: number | null;
  currency: string; observation: string; observedAt: Date; nearbyAtSubmit: boolean;
  confirmations: { kind: string; createdAt: Date; userId: string }[];
};

/** Explicit fältlista — `discordMessageId` och andra interna kolumner lämnar aldrig servern. */
function toStoreReportDto(r: StoreReportRow | null | undefined, images: Map<string, string | null>, authorId: string): StoreReportDto | null {
  if (!r) return null;
  return {
    store: r.store, productLabel: r.productLabel, productSlug: r.productSlug, priceOre: r.priceOre,
    currency: r.currency, observation: r.observation, observedAt: r.observedAt.toISOString(),
    nearbyAtSubmit: r.nearbyAtSubmit, ...tallyVotes(r.confirmations, authorId),
    productImageUrl: r.productSlug ? images.get(r.productSlug) ?? null : null,
  };
}

/** EN fråga för sidans alla rapportprodukter — bilden gör kortet läsbart på ett ögonkast. */
async function reportProductImages(slugs: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(slugs.filter((s): s is string => !!s))];
  if (!unique.length) return new Map();
  const rows = await prisma.product.findMany({ where: { slug: { in: unique } }, select: { slug: true, imageUrl: true } });
  return new Map(rows.map((r) => [r.slug, r.imageUrl]));
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
  reportsOnly?: boolean;
  storeId?: string;
  productSlug?: string;
  city?: string;
  groupSlug?: string;
  /** Bara en viss författares trådar (profilens Inlägg-flik). */
  authorId?: string;
  kind?: ListingKind;
  /**
   * Annonsstatus. Utelämnad = "det som är aktuellt": vanliga trådar (null) +
   * aktiva annonser. Sålda/avslutade göms ur flödet men finns kvar på sin URL.
   */
  status?: ListingStatus | "all";
  /**
   * "Bara färska fynd": Finns-rapporter inom färskhetsfönstret vars senaste röst inte
   * säger "inte kvar". Värdet är 10-minutersfacket (`freshBucket`), så den delade
   * cachen åldras med klockan.
   */
  freshBucket?: number;
  page: number;
  pageSize: number;
}

const FEED_INCLUDE = {
  storeReport: STORE_REPORT_INCLUDE,
  user: { select: POST_AUTHOR_SELECT },
  group: { select: GROUP_REF_SELECT },
  images: { orderBy: { sortOrder: "asc" }, take: 6, select: IMAGE_SELECT },
  _count: { select: { comments: true, likes: true } },
} satisfies Prisma.CommunityPostInclude;

type FeedRow = Prisma.CommunityPostGetPayload<{ include: typeof FEED_INCLUDE }>;

function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 180 ? flat : `${flat.slice(0, 179)}…`;
}

type StoredImage = {
  key: string;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
};

/**
 * `thumb` = trådlistan, som visar 80×80: signera MINIATYREN när den finns.
 * Utan den är kortets bild originalet på ~300 kB, och tjugo kort blev ~6 MB —
 * på mobilnätet syntes det som att bilderna aldrig kom in (mätt 2026-09-07).
 * Gamla bilder saknar miniatyr och faller tillbaka på originalet; ⛔ gissa
 * aldrig fram nyckeln, en härledd nyckel utan fil är en trasig bild.
 */
async function signImages(images: StoredImage[], opts: { thumb?: boolean } = {}): Promise<ForumImage[]> {
  if (images.length === 0) return [];
  const urls = await imageUrls(images.map((i) => (opts.thumb && i.thumbKey ? i.thumbKey : i.key)));
  return images.map(({ thumbKey: _thumbKey, ...img }, i) => ({ ...img, url: urls[i] ?? null }));
}

async function toFeedItems(rows: FeedRow[]): Promise<FeedItem[]> {
  // EN signeringsrunda för hela sidan (ren kryptografi, men håll den samlad).
  const flat = rows.flatMap((r) => r.images);
  const [signed, productImages] = await Promise.all([
    signImages(flat, { thumb: true }),
    reportProductImages(rows.map((r) => r.storeReport?.productSlug)),
  ]);
  let cursor = 0;
  return rows.map((r) => {
    const images = signed.slice(cursor, cursor + r.images.length);
    cursor += r.images.length;
    return {
      id: r.id,
      title: r.title,
      excerpt: excerptOf(r.content),
      content: r.content,
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
      storeReport: toStoreReportDto(r.storeReport, productImages, r.userId),
    };
  });
}

export function buildFeedWhere(
  params: Pick<FeedParams, "groupSlug" | "authorId" | "kind" | "status" | "reportsOnly" | "storeId" | "productSlug" | "city" | "freshBucket">
) {
  const where: Prisma.CommunityPostWhereInput = { isHidden: false };
  if (params.reportsOnly || params.storeId || params.productSlug || params.city || params.freshBucket != null) {
    where.storeReport = { is: {
      store: { status: "APPROVED", ...(params.city ? { city: { contains: params.city, mode: "insensitive" } } : {}) },
      ...(params.storeId ? { storeId: params.storeId } : {}),
      ...(params.productSlug ? { productSlug: params.productSlug } : {}),
      ...(params.freshBucket != null ? {
        observation: "SEEN",
        observedAt: { gte: new Date(params.freshBucket * FRESH_BUCKET_MS - REPORT_FRESH_HOURS * 3600_000) },
      } : {}),
    } };
  }
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

async function getFeedRaw(params: FeedParams) {
  const { page, pageSize } = params;
  const where = buildFeedWhere(params);

  if (params.freshBucket != null) {
    // Färska fynd är få (12 h-fönster): läs alla, släng de där senaste rösten säger
    // "inte kvar" och sidindela i minnet — rösterna går inte att filtrera i SQL.
    const rows = await prisma.communityPost.findMany({
      where,
      include: FEED_INCLUDE,
      orderBy: [{ storeReport: { observedAt: "desc" } }, { id: "desc" }],
      take: 200,
    });
    const still = rows.filter((r) => tallyVotes(r.storeReport?.confirmations ?? [], r.userId).lastVote?.kind !== "DISPUTE");
    const items = await toFeedItems(still.slice((page - 1) * pageSize, page * pageSize));
    return { items, total: still.length, page, pageSize, totalPages: Math.max(1, Math.ceil(still.length / pageSize)) };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.communityPost.findMany({
      where,
      include: FEED_INCLUDE,
      // ⛔ Ett nytt svar gör inte hyllobservationen färsk igen. Rapporter
      // sorteras på BESÖKET, aldrig på kommentarer eller publicering hemifrån.
      orderBy: params.reportsOnly || params.storeId || params.city || params.productSlug
        ? [{ storeReport: { observedAt: "desc" } }, { id: "desc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.communityPost.count({ where }),
  ]);

  const items = await toFeedItems(rows);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const getFeed = cachedRead(getFeedRaw, "community-feed-v7", 3600, ["community-feed"]);

/** Ett valt äldre inlägg på profilen: samma miniatyrer/modereringsvakt som
 * flödet, en delad läsning i stället för att hämta alla personens sidor. */
export const getProfileFeedItem = cachedRead(async (postId: string, authorId: string): Promise<FeedItem | null> => {
  const row = await prisma.communityPost.findFirst({ where: { id: postId, userId: authorId, isHidden: false }, include: FEED_INCLUDE });
  return row ? (await toFeedItems([row]))[0] : null;
}, "community-profile-feed-item-v3", 3600, ["community-feed"]);

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
      storeReport: STORE_REPORT_INCLUDE,
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
    storeReport: toStoreReportDto(post.storeReport, await reportProductImages([post.storeReport?.productSlug]), post.userId),
  };
}

export interface CreatePostInput {
  storeReport?: { storeId: string; productLabel: string; productSlug: string | null; priceOre: number; currency: string; observation: string; observedAt: Date; nearbyAtSubmit: boolean };
  groupId: string;
  title: string;
  content: string;
  images: { key: string; thumbKey?: string | null; width?: number | null; height?: number | null }[];
  listingKind?: ListingKind | null;
  priceOre?: number | null;
  condition?: string | null;
  productId?: string | null;
  traderaUrl?: string | null;
}

export async function createPost(userId: string, input: CreatePostInput) {
  const { images, groupId, listingKind, storeReport, ...rest } = input;
  return prisma.communityPost.create({
    data: {
      userId,
      groupId,
      ...(storeReport ? { storeReport: { create: storeReport } } : {}),
      ...rest,
      listingKind: listingKind ?? null,
      // Annonsstatus följer annonstypen: en annons föds aktiv, en vanlig tråd
      // har ingen status alls (null håller den utanför marknadsfiltren).
      listingStatus: listingKind ? "ACTIVE" : null,
      images: {
        create: images.map((img, i) => ({
          key: img.key,
          thumbKey: img.thumbKey ?? null,
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
      images: { select: { key: true, thumbKey: true } },
      group: { select: { slug: true } },
      storeReport: { select: { discordMessageId: true } },
    },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  if (post.userId !== userId && !hasRole(userRole, "MODERATOR")) {
    throw new ServiceError(403, "Du får inte ta bort den här tråden.");
  }
  await prisma.communityPost.delete({ where: { id: postId } });
  return {
    deleted: true as const,
    // Miniatyren är en egen fil i bucketen — den måste med i städningen.
    imageKeys: post.images.flatMap((i) => (i.thumbKey ? [i.key, i.thumbKey] : [i.key])),
    groupSlug: post.group?.slug ?? null,
    // Butikslarmets spegel i Discord ska bort med inlägget (lib/discord-store-report.ts).
    discordMessageIds: [post.storeReport?.discordMessageId ?? null],
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

// Kommentararket läses på uttryckligt öppnande, aldrig via timer. Skrivning,
// moderering och GDPR kastar samma tagg som flödet, så cache delar läsningen.
export const listCommentsCached = cachedRead(listComments, "community-comments-v1", 3600, ["community-feed"]);

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

export interface PostCounts {
  likeCount: number;
  commentCount: number;
}

/**
 * FÄRSKA RÄKNARE FÖR `postIds` — det ISR-HTML:en INTE kan bära.
 *
 * ⛔ Trådsidan är ISR-cachad (300 s) och Nexts klient-routercache serverar samma
 * RSC-nyttolast i 30 s till. Gillningar och svar som kommer efter renderingen
 * finns alltså inte i sidan: mätt 2026-09-07 visade flödet "1 gillning, 1 svar"
 * medan tråden man öppnade sa 0 och "Inga svar ännu" — och hjärtat var FYLLT
 * bredvid en nolla, för `liked` kom från den färska /me-läsningen och siffran
 * från den gamla HTML:en. Att invalidera sidan vid varje gillning hade renderat
 * om ALLA trådsidor (revalidatePath tar hela mönstret) för en siffra.
 *
 * Räknarna åker därför med i det anrop klienten ändå gör vid varje trådöppning
 * (`/api/community/me`) — samma Neon-väckning, två extra små frågor.
 *
 * ⛔ Kommentarerna räknas som `listComments` listar dem (`isHidden: false`),
 * annars skulle en gömd kommentar göra att klienten ALLTID tror att listan är
 * gammal och hämtar om den i onödan.
 */
export async function postCounts(postIds: string[]): Promise<Record<string, PostCounts>> {
  if (postIds.length === 0) return {};
  const [likes, comments] = await Promise.all([
    prisma.like.groupBy({
      by: ["postId"],
      where: { postId: { in: postIds } },
      _count: { postId: true },
    }),
    prisma.comment.groupBy({
      by: ["postId"],
      where: { postId: { in: postIds }, isHidden: false },
      _count: { postId: true },
    }),
  ]);
  const out: Record<string, PostCounts> = {};
  for (const id of postIds) out[id] = { likeCount: 0, commentCount: 0 };
  for (const row of likes) if (out[row.postId]) out[row.postId].likeCount = row._count.postId;
  for (const row of comments) if (out[row.postId]) out[row.postId].commentCount = row._count.postId;
  return out;
}

/** Vad DEN HÄR användaren gillat/sparat bland `postIds` — två små läsningar. */
export async function personalPostState(userId: string, postIds: string[]) {
  if (postIds.length === 0) return { likedIds: [] as string[], savedIds: [] as string[], reportVotes: {} as Record<string, StoreReportVote> };
  const [likes, saved, confirmed] = await prisma.$transaction([
    prisma.like.findMany({ where: { userId, postId: { in: postIds } }, select: { postId: true } }),
    prisma.savedPost.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true },
    }),
    prisma.communityStoreReportConfirmation.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true, kind: true },
    }),
  ]);
  return {
    likedIds: likes.map((l) => l.postId),
    savedIds: saved.map((s) => s.postId),
    reportVotes: Object.fromEntries(
      confirmed.map((c) => [c.postId, c.kind === "DISPUTE" ? "DISPUTE" : "CONFIRM"])
    ) as Record<string, StoreReportVote>,
  };
}

/**
 * En medlems röst på en butiksrapport: CONFIRM ("stämmer fortfarande") eller DISPUTE
 * ("inte längre"). Samma knapp igen tar bort rösten, den andra byter den.
 *
 * RAPPORTÖREN röstar också — rapporten är redan deras CONFIRM. Trycker de på andra
 * sidan FLYTTAS rösten dit (en DISPUTE-rad med deras id), trycker de tillbaka tas
 * raden bort. Aldrig en extra röst, aldrig båda sidor (ägarbeslut 2026-10-05).
 *
 * Bara medan rapporten är färsk (en röst om gårdagens hylla säger ingenting) och
 * aldrig på ett dolt inlägg. Att ta bort sin röst går alltid.
 */
export async function voteStoreReport(postId: string, userId: string, kind: StoreReportVote) {
  const report = await prisma.communityStoreReport.findUnique({
    where: { postId },
    select: { observedAt: true, post: { select: { userId: true, isHidden: true } } },
  });
  if (!report || report.post.isHidden) throw new ServiceError(404, "Rapporten hittades inte.");
  const isAuthor = report.post.userId === userId;
  const key = { postId_userId: { postId, userId } };
  const existing = await prisma.communityStoreReportConfirmation.findUnique({ where: key });
  // Rapportörens utgångsläge är CONFIRM (rapporten själv), alla andras är "ingen röst".
  const current: StoreReportVote | null = existing ? (existing.kind === "DISPUTE" ? "DISPUTE" : "CONFIRM") : isAuthor ? "CONFIRM" : null;
  const next: StoreReportVote | null = isAuthor
    ? (current === kind ? "CONFIRM" : kind) // rapportören kan bara flytta, aldrig stå utan sida
    : current === kind ? null : kind;
  if (next !== current) {
    const removeRow = next === null || (isAuthor && next === "CONFIRM");
    if (removeRow) {
      await prisma.communityStoreReportConfirmation.deleteMany({ where: { postId, userId } });
    } else {
      if (!reportIsFresh(report.observedAt.toISOString())) {
        throw new ServiceError(400, "Rapporten är för gammal för att bekräftas.");
      }
      await prisma.communityStoreReportConfirmation.upsert({
        where: key,
        create: { postId, userId, kind: next! },
        update: { kind: next!, createdAt: new Date() },
      });
    }
  }
  const votes = await prisma.communityStoreReportConfirmation.findMany({
    where: { postId },
    select: { kind: true, createdAt: true, userId: true },
  });
  return { vote: next, ...tallyVotes(votes, report.post.userId) };
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
    select: { id: true, storeReport: { select: { discordMessageId: true } } },
  });
  if (!post) throw new ServiceError(404, "Tråden hittades inte.");
  if (hidden) await deleteStoreReportFromDiscord([post.storeReport?.discordMessageId]);
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
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { post: { select: { storeReport: { select: { discordMessageId: true } } } } },
  });
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
  // Ett dolt inlägg får inte leva kvar som butikslarm i Discord.
  if (opts.hidePost) await deleteStoreReportFromDiscord([report.post?.storeReport?.discordMessageId]);
  return updated;
}
