"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMessage } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import { PostCard } from "./post-card";
import { LoadMore } from "./load-more";

export interface FeedPage {
  items: FeedItem[];
  total: number;
  page: number;
  pageSize: number;
}

type MarketFilter = "all" | "SELL" | "BUY" | "TRADE" | "sold";

const FILTERS: { id: MarketFilter; key: "filterAll" | "kindSell" | "kindBuy" | "kindTrade" | "filterSold" }[] = [
  { id: "all", key: "filterAll" },
  { id: "SELL", key: "kindSell" },
  { id: "BUY", key: "kindBuy" },
  { id: "TRADE", key: "kindTrade" },
  { id: "sold", key: "filterSold" },
];

function buildUrl(group: string | undefined, filter: MarketFilter, page: number): string {
  const p = new URLSearchParams();
  if (group) p.set("group", group);
  if (filter === "sold") p.set("status", "SOLD");
  else if (filter !== "all") p.set("kind", filter);
  p.set("page", String(page));
  p.set("pageSize", "20");
  return `/api/community/posts?${p.toString()}`;
}

/**
 * Trådlistan: första sidan kommer serverrenderad (ISR), resten hämtas här.
 * Marknadsgruppen får en filterrad; varje filter minns sin senaste sida i
 * `pagesRef` så att växla fram och tillbaka inte kostar en ny fråga.
 */
export function ThreadList({
  initial,
  group,
  marketplace = false,
  showGroup = true,
  emptyText,
}: {
  initial: FeedPage;
  group?: string;
  marketplace?: boolean;
  showGroup?: boolean;
  emptyText: string;
}) {
  const t = useTranslations("Forum");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [pages, setPages] = useState<Record<string, FeedPage>>({ all: initial });
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const current = pages[filter];

  const fetchPage = useCallback(
    async (f: MarketFilter, page: number, append: boolean) => {
      setLoading(true);
      try {
        const res = await fetch(buildUrl(group, f, page), { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as FeedPage;
        setPages((prev) => {
          const existing = append ? prev[f] : undefined;
          return {
            ...prev,
            [f]: {
              ...data,
              items: existing ? [...existing.items, ...data.items] : data.items,
            },
          };
        });
      } catch {
        // nätverksfel — behåll det som visas
      } finally {
        setLoading(false);
      }
    },
    [group]
  );

  function selectFilter(f: MarketFilter) {
    setFilter(f);
    if (!pagesRef.current[f]) void fetchPage(f, 1, false);
  }

  const hasMore = current ? current.items.length < current.total : false;

  return (
    <div className="space-y-3">
      {marketplace && (
        <div className="-mx-2.5 sm:mx-0" role="tablist" aria-label={t("filterLabel")}>
          <div className="flex gap-2 overflow-x-auto px-2.5 py-1 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectFilter(f.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors",
                    active
                      ? "border-holo-cyan/45 bg-holo-cyan/[0.14] text-holo-cyan"
                      : "border-surface-border bg-surface text-ink hover:bg-surface-overlay"
                  )}
                >
                  {t(f.key)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!current ? (
        <p className="py-8 text-center text-sm text-ink-muted">{t("loading")}</p>
      ) : current.items.length === 0 ? (
        <EmptyState icon={<IconMessage size={32} />} title={emptyText} description="" />
      ) : (
        <ul className="space-y-2.5">
          {current.items.map((post) => (
            <PostCard key={post.id} post={post} showGroup={showGroup} />
          ))}
        </ul>
      )}

      <LoadMore
        hasMore={hasMore}
        loading={loading}
        onClick={() => current && void fetchPage(filter, current.page + 1, true)}
      />
    </div>
  );
}
