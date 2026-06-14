/** Communitytjänster: flöde, inlägg, kommentarer, likes, sparade, rapporter, moderering. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { hasRole } from "@/lib/auth";
import type { PostCategory, ReportStatus, Role } from "@prisma/client";

const POST_AUTHOR_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  reputationScore: true,
} as const;

export interface FeedParams {
  category?: PostCategory;
  page: number;
  pageSize: number;
  userId?: string; // för hasLiked/hasSaved
}

export async function getFeed(params: FeedParams) {
  const { category, page, pageSize, userId } = params;
  const where = { isHidden: false, ...(category ? { category } : {}) };

  const [posts, total] = await prisma.$transaction([
    prisma.communityPost.findMany({
      where,
      include: {
        user: { select: POST_AUTHOR_SELECT },
        _count: { select: { comments: true, likes: true } },
        ...(userId
          ? {
              likes: { where: { userId }, select: { id: true } },
              savedPosts: { where: { userId }, select: { id: true } },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.communityPost.count({ where }),
  ]);

  const items = posts.map((p) => {
    const { _count, likes, savedPosts, ...rest } = p as typeof p & {
      likes?: { id: string }[];
      savedPosts?: { id: string }[];
    };
    return {
      ...rest,
      commentCount: _count.comments,
      likeCount: _count.likes,
      hasLiked: (likes?.length ?? 0) > 0,
      hasSaved: (savedPosts?.length ?? 0) > 0,
    };
  });

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getPost(postId: string, userId?: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    include: {
      user: { select: POST_AUTHOR_SELECT },
      _count: { select: { comments: true, likes: true } },
      ...(userId
        ? {
            likes: { where: { userId }, select: { id: true } },
            savedPosts: { where: { userId }, select: { id: true } },
          }
        : {}),
    },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Inlägget hittades inte.");
  const { _count, likes, savedPosts, ...rest } = post as typeof post & {
    likes?: { id: string }[];
    savedPosts?: { id: string }[];
  };
  return {
    ...rest,
    commentCount: _count.comments,
    likeCount: _count.likes,
    hasLiked: (likes?.length ?? 0) > 0,
    hasSaved: (savedPosts?.length ?? 0) > 0,
  };
}

export interface CreatePostInput {
  title: string;
  content: string;
  category: PostCategory;
  imageUrl?: string;
}

export async function createPost(userId: string, input: CreatePostInput) {
  return prisma.communityPost.create({
    data: { userId, ...input },
    include: {
      user: { select: POST_AUTHOR_SELECT },
      _count: { select: { comments: true, likes: true } },
    },
  });
}

/** Radera inlägg – tillåtet för ägaren eller moderator+. */
export async function deletePost(postId: string, userId: string, userRole: Role) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId } });
  if (!post) throw new ServiceError(404, "Inlägget hittades inte.");
  if (post.userId !== userId && !hasRole(userRole, "MODERATOR")) {
    throw new ServiceError(403, "Du får inte ta bort detta inlägg.");
  }
  await prisma.communityPost.delete({ where: { id: postId } });
  return { deleted: true };
}

export async function listComments(postId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Inlägget hittades inte.");
  return prisma.comment.findMany({
    where: { postId, isHidden: false },
    include: { user: { select: POST_AUTHOR_SELECT } },
    orderBy: { createdAt: "asc" },
  });
}

export async function addComment(postId: string, userId: string, content: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Inlägget hittades inte.");
  return prisma.comment.create({
    data: { postId, userId, content },
    include: { user: { select: POST_AUTHOR_SELECT } },
  });
}

/** Växlar like på ett inlägg. Returnerar nytt tillstånd + antal. */
export async function toggleLike(postId: string, userId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Inlägget hittades inte.");

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

/** Växlar sparat inlägg. */
export async function toggleSave(postId: string, userId: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, isHidden: true },
  });
  if (!post || post.isHidden) throw new ServiceError(404, "Inlägget hittades inte.");

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

export async function reportPost(postId: string, reporterId: string, reason: string) {
  const post = await prisma.communityPost.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) throw new ServiceError(404, "Inlägget hittades inte.");
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
  if (!post) throw new ServiceError(404, "Inlägget hittades inte.");
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
