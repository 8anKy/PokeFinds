import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, hasRole } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { getPost, listComments } from "@/services/community";
import { POST_CATEGORY_LABELS, POST_CATEGORY_VARIANTS } from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { PostActions, type CommentRow } from "./post-actions";
import { IconChevronLeft } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

async function loadPost(id: string, userId?: string) {
  try {
    return await getPost(id, userId);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const post = await loadPost(params.id);
  return { title: post ? post.title : "Inlägget hittades inte" };
}

export default async function PostPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const post = await loadPost(params.id, session?.user?.id);
  if (!post) notFound();

  let comments: CommentRow[] = [];
  try {
    const raw = await listComments(post.id);
    comments = raw.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      user: {
        id: c.user.id,
        name: c.user.name,
        reputationScore: c.user.reputationScore,
      },
    }));
  } catch {
    comments = [];
  }

  const viewer = session?.user
    ? { id: session.user.id, isModerator: hasRole(session.user.role, "MODERATOR") }
    : null;

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/community"
        className="inline-flex items-center gap-1 text-sm font-medium text-holo-cyan hover:underline"
      >
        <IconChevronLeft size={16} />
        Tillbaka till communityt
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>
            {POST_CATEGORY_LABELS[post.category]}
          </Badge>
          <Link
            href={`/profil/${post.user.id}`}
            className="font-medium text-ink-muted transition-colors hover:text-holo-cyan"
          >
            {post.user.name}
          </Link>
          <span>·</span>
          <span>{formatRelative(post.createdAt)}</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold text-ink">{post.title}</h1>
      </header>

      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt=""
          className="mt-6 max-h-[480px] w-full rounded-xl border border-surface-border object-contain"
        />
      )}

      <div className="prose-invert mt-6 whitespace-pre-wrap text-base leading-relaxed text-ink">
        {post.content}
      </div>

      <div className="mt-8 border-t border-surface-border pt-6">
        <PostActions
          postId={post.id}
          initialLiked={post.hasLiked}
          initialLikeCount={post.likeCount}
          initialSaved={post.hasSaved}
          initialComments={comments}
          isOwner={viewer?.id === post.user.id}
          viewer={viewer}
        />
      </div>
    </article>
  );
}
