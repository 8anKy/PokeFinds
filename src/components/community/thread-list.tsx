"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMessage } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import { PostCard } from "./post-card";
import { LoadMore } from "./load-more";
import { useForumViewer } from "./use-forum-viewer";
import { apiFetch } from "@/lib/client-api";

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

function buildUrl(
  group: string | undefined,
  author: string | undefined,
  filter: MarketFilter,
  page: number
): string {
  const p = new URLSearchParams();
  if (group) p.set("group", group);
  if (author) {
    p.set("author", author);
    // Profilen visar även sålda/avslutade annonser — det är personens historik.
    p.set("status", "all");
  }
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
  author,
  marketplace = false,
  showGroup = true,
  emptyText,
  hrefBase,
  visual = false,
  reportQuery,
}: {
  initial: FeedPage;
  group?: string;
  /** Författar-id: listan blir personens egna trådar (profilens Inlägg-flik). */
  author?: string;
  marketplace?: boolean;
  showGroup?: boolean;
  emptyText: string;
  /** Vart en tråd länkar; profilen utanför grinden pekar på gamla /community. */
  hrefBase?: string;
  visual?: boolean;
  reportQuery?: string;
}) {
  const t = useTranslations("Forum");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [pages, setPages] = useState<Record<string, FeedPage>>({ all: initial });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPages({ all: initial }); setFilter("all"); }, [initial]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const current = pages[filter];
  const personal = useForumViewer(current?.items.map(p => p.id) ?? []);

  const fetchPage = useCallback(
    async (f: MarketFilter, page: number, append: boolean) => {
      setLoading(true);
      setError("");
      try {
        const url = reportQuery ? `/api/community/posts?${reportQuery}&page=${page}&pageSize=20` : buildUrl(group, author, f, page);
        const data = await apiFetch<FeedPage>(url);
        setPages((prev) => {
          const existing = append ? prev[f] : undefined;
          return {
            ...prev,
            [f]: {
              ...data,
              items: existing ? [...existing.items, ...data.items.filter(p => !existing.items.some(e => e.id === p.id))] : data.items,
            },
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t("somethingWrong"));
      } finally {
        setLoading(false);
      }
    },
    [group, author, reportQuery, t]
  );

  function selectFilter(f: MarketFilter) {
    setFilter(f);
    if (!pagesRef.current[f]) void fetchPage(f, 1, false);
  }

  // ⛔ Nya inlägg kan flytta sidgränsen under scrollningen. Efter avdubblering
  // är antal VISNINGAR mindre än totalen; det får inte ge ändlös tom paginering.
  const hasMore = current ? current.page * current.pageSize < current.total : false;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visual || !hasMore || loading || error || !current || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { observer.disconnect(); void fetchPage(filter, current.page + 1, true); }
    }, { rootMargin: "200px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [visual, hasMore, loading, error, current, filter, fetchPage]);

  return (
    <div className="space-y-3">
      {marketplace && (
        <div className="-mx-2.5 sm:mx-0" role="tablist" aria-label={t("filterLabel")}>
          {/* data-swipe-ignore: raden äger sitt vågräta drag (SwipeBack/SwipeTabs rör den inte). */}
          <div
            data-swipe-ignore
            className="flex gap-2 overflow-x-auto px-2.5 py-1 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
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
        <ul className={visual ? "-mx-2.5 space-y-4 sm:mx-0" : "space-y-2.5"}>
          {current.items.filter(post => !personal.state.blockedIds.includes(post.user.id)).map((post) => (
            <PostCard key={post.id} post={post} showGroup={showGroup} hrefBase={hrefBase} visual={visual} personal={personal} />
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-sm text-fall">{error}</p>}
      <div ref={sentinel} aria-hidden="true" />
      <LoadMore
        hasMore={hasMore}
        loading={loading}
        onClick={() => current && void fetchPage(filter, current.page + 1, true)}
      />
    </div>
  );
}
