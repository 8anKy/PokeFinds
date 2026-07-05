"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardLanguage, ProductCategory, StockStatus } from "@prisma/client";
import { ProductCard } from "@/components/features/product-card";

/** Det feed-API:t returnerar per produkt (delmängd av ProductListItem). */
export interface FeedItem {
  id: string;
  title: string;
  slug: string;
  category: ProductCategory;
  imageUrl: string | null;
  language: CardLanguage;
  lowestPrice: number | null;
  lowestPriceStockStatus: StockStatus | null;
  inStockCount: number;
  priceChange7dPercent: number | null;
  dealPercent?: number | null;
  dealListingTitle?: string | null;
}

interface FeedResponse {
  items: FeedItem[];
  total: number;
  hasMore: boolean;
}

/**
 * Infinite-scroll-feed för utforska-sidan. Renderar initiala produkter (SSR) och
 * hämtar fler i poster om 24 när en sentinel nära botten kommer i vy
 * (IntersectionObserver). Laddar aldrig in hela katalogen på en gång → ingen lagg.
 */
export function ExploreFeed({
  initialItems,
  initialHasMore,
  feedQuery,
  pageSize,
}: {
  initialItems: FeedItem[];
  initialHasMore: boolean;
  feedQuery: string;
  pageSize: number;
}) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [offset, setOffset] = useState(initialItems.length);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/products/feed?${feedQuery}&offset=${offset}&limit=${pageSize}`);
      if (!res.ok) throw new Error("feed");
      const data = (await res.json()) as FeedResponse;
      setItems((prev) => [...prev, ...data.items]);
      setOffset((prev) => prev + data.items.length);
      setHasMore(data.hasMore && data.items.length > 0);
    } catch {
      setError(true);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, offset, feedQuery, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px 0px" } // börja ladda i förväg → sömlös scroll
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((p) => (
          <ProductCard
            key={p.id}
            product={{
              slug: p.slug,
              title: p.title,
              imageUrl: p.imageUrl,
              category: p.category,
              lowestPrice: p.lowestPrice,
              priceChange7d: p.priceChange7dPercent,
              stockStatus: p.lowestPriceStockStatus,
              retailerCount: p.inStockCount,
              dealPercent: p.dealPercent,
              dealListingTitle: p.dealListingTitle,
            }}
          />
        ))}
      </div>

      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px w-full" />}

      <div className="mt-8 flex justify-center" aria-live="polite">
        {loading && (
          <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-border border-t-holo-cyan" />
            Laddar fler produkter…
          </span>
        )}
        {error && (
          <button
            type="button"
            onClick={() => { setHasMore(true); void loadMore(); }}
            className="rounded-lg border border-surface-border px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            Något gick fel — försök igen
          </button>
        )}
        {!hasMore && !loading && !error && items.length > 0 && (
          <span className="text-sm text-ink-faint">Du har sett alla {items.length} produkter</span>
        )}
      </div>
    </>
  );
}
