import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { getFeed } from "@/services/community";
import {
  POST_CATEGORY_LABELS,
  POST_CATEGORY_VARIANTS,
  isPostCategory,
} from "@/lib/community-labels";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NewPostButton } from "./new-post-button";
import {
  IconChevronLeft,
  IconChevronRight,
  IconHeart,
  IconMessage,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Dela dina pulls, byt kort och diskutera Pokémon TCG-marknaden med svenska samlare.",
};

const PAGE_SIZE = 20;

function excerpt(content: string, max = 180): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function pageLink(kategori: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (kategori) params.set("kategori", kategori);
  if (page > 1) params.set("sida", String(page));
  const qs = params.toString();
  return qs ? `/community?${qs}` : "/community";
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: { kategori?: string; sida?: string };
}) {
  const session = await auth();
  const category =
    searchParams.kategori && isPostCategory(searchParams.kategori)
      ? searchParams.kategori
      : undefined;
  const page = Math.max(1, Number(searchParams.sida) || 1);

  const feed = await getFeed({
    category,
    page,
    pageSize: PAGE_SIZE,
    userId: session?.user?.id,
  });

  const chips: { value: string | undefined; label: string }[] = [
    { value: undefined, label: "Alla" },
    ...Object.entries(POST_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Community</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Pulls, byten och marknadssnack — av samlare, för samlare.
          </p>
        </div>
        <NewPostButton isLoggedIn={Boolean(session?.user)} />
      </div>

      {/* Kategorifilter */}
      <div className="mt-6 flex flex-wrap gap-2" role="navigation" aria-label="Kategorifilter">
        {chips.map((chip) => {
          const active = chip.value === category || (!chip.value && !category);
          return (
            <Link
              key={chip.label}
              href={pageLink(chip.value, 1)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-holo-cyan bg-holo-cyan/10 text-holo-cyan"
                  : "border-surface-border text-ink-muted hover:border-holo-cyan/40 hover:text-ink"
              )}
              aria-current={active ? "page" : undefined}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>

      {/* Flöde */}
      <div className="mt-6 space-y-4">
        {feed.items.length === 0 ? (
          <EmptyState
            icon={<IconMessage size={32} />}
            title="Inga inlägg här ännu"
            description="Bli först att starta diskussionen — dela en pull eller ställ en fråga!"
          />
        ) : (
          feed.items.map((post) => (
            <Card key={post.id} className="transition-colors hover:border-holo-cyan/40">
              <Link href={`/community/${post.id}`} className="block p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <Badge variant={POST_CATEGORY_VARIANTS[post.category]}>
                    {POST_CATEGORY_LABELS[post.category]}
                  </Badge>
                  <span className="font-medium text-ink-muted">{post.user.name}</span>
                  <span>·</span>
                  <span>{formatRelative(post.createdAt)}</span>
                </div>
                <h2 className="mt-2 font-display text-lg font-semibold text-ink">
                  {post.title}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">{excerpt(post.content)}</p>
                <p className="mt-3 flex items-center gap-4 text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <IconHeart size={14} />
                    <span className="tabular-nums">{post.likeCount}</span> gilla-markeringar
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <IconMessage size={14} />
                    <span className="tabular-nums">{post.commentCount}</span> kommentarer
                  </span>
                </p>
              </Link>
            </Card>
          ))
        )}
      </div>

      {/* Sidnavigering */}
      {feed.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-between" aria-label="Sidnavigering">
          {page > 1 ? (
            <Link
              href={pageLink(category, page - 1)}
              className="inline-flex items-center gap-1 text-sm font-medium text-holo-cyan hover:underline"
            >
              <IconChevronLeft size={16} />
              Föregående
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-muted">
            Sida {feed.page} av {feed.totalPages}
          </span>
          {page < feed.totalPages ? (
            <Link
              href={pageLink(category, page + 1)}
              className="inline-flex items-center gap-1 text-sm font-medium text-holo-cyan hover:underline"
            >
              Nästa
              <IconChevronRight size={16} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
