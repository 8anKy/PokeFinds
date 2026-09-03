"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBookmark, IconHeart } from "@/components/ui/icons";
import { SwipeTabs } from "@/components/ui/swipe-tabs";
import type { FeedPage } from "./thread-list";
import { PostCard } from "./post-card";
import { LoadMore } from "./load-more";

type Kind = "saved" | "liked";

/**
 * Dit "Spara" och "Gilla" leder: två flikar, svepbara (SwipeTabs). Första sidan
 * av båda kommer serverrenderad; "Visa fler" hämtar nästa sida per flik.
 */
export function SavedThreads({ saved, liked }: { saved: FeedPage; liked: FeedPage }) {
  const t = useTranslations("Forum");
  return (
    <SwipeTabs
      ariaLabel={t("savedTitle")}
      tabs={[
        {
          id: "saved",
          label: t("savedTab"),
          content: (
            <PersonalList
              kind="saved"
              initial={saved}
              empty={
                <EmptyState
                  icon={<IconBookmark size={32} />}
                  title={t("savedEmpty")}
                  description=""
                />
              }
            />
          ),
        },
        {
          id: "liked",
          label: t("likedTab"),
          content: (
            <PersonalList
              kind="liked"
              initial={liked}
              empty={
                <EmptyState icon={<IconHeart size={32} />} title={t("likedEmpty")} description="" />
              }
            />
          ),
        },
      ]}
    />
  );
}

function PersonalList({
  kind,
  initial,
  empty,
}: {
  kind: Kind;
  initial: FeedPage;
  empty: React.ReactNode;
}) {
  const [page, setPage] = useState<FeedPage>(initial);
  const [loading, setLoading] = useState(false);
  const hasMore = page.items.length < page.total;

  async function loadMore() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        kind,
        page: String(page.page + 1),
        pageSize: String(page.pageSize),
      });
      const res = await fetch(`/api/community/saved?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const next = (await res.json()) as FeedPage;
      setPage((prev) => ({ ...next, items: [...prev.items, ...next.items] }));
    } catch {
      // nätverksfel — behåll det som visas
    } finally {
      setLoading(false);
    }
  }

  if (page.items.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {page.items.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </ul>
      <LoadMore hasMore={hasMore} loading={loading} onClick={() => void loadMore()} />
    </div>
  );
}
