"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { formatPrice } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { LISTING_STATUS_KEYS } from "@/lib/community-labels";
import { EmptyState } from "@/components/ui/empty-state";
import { CircleButton } from "@/components/ui/back-circle";
import { IconChevronLeft, IconMessage } from "@/components/ui/icons";
import type { FeedItem } from "@/services/community";
import type { FeedPage } from "./thread-list";
import { PostCard } from "./post-card";
import { useForumViewer } from "./use-forum-viewer";

/**
 * Profilens Inlägg-flik som RUTNÄT (ägarbeslut 2026-10-09, "som Instagram"): två
 * kolumner stående 4:5-rutor. Ett tryck öppnar en helskärmsvy med personens inlägg
 * i flödesform, scrollad till det valda — upp och ned når man resten, nyp zoomar.
 *
 * ⛔ Vyn renderas i en PORTAL: profilen ligger i SwipeBack:s fasta yta med
 *    `will-change: transform`, som annars blir containing block och håller vyn
 *    under bottenflikarna. ⛔ Bakåt (Android, webbläsaren) stänger vyn — samma
 *    historikmarkör som bildvisaren (ui/image-lightbox.tsx).
 */
export function ProfilePostGrid({
  initial,
  author,
  authorName,
  emptyText,
  initialOpenId,
}: {
  initial: FeedPage;
  author: string;
  authorName: string;
  emptyText: string;
  /** Äldre länk med `?inlagg=` — öppna vyn direkt vid det inlägget. */
  initialOpenId?: string | null;
}) {
  const t = useTranslations("Profile");
  const tForum = useTranslations("Forum");
  const [page, setPage] = useState<FeedPage>(initial);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  useEffect(() => setPage(initial), [initial]);

  const personal = useForumViewer(page.items.map((p) => p.id));
  const items = page.items.filter((p) => !personal.state.blockedIds.includes(p.user.id));
  const hasMore = page.page * page.pageSize < page.total;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ author, status: "all", page: String(page.page + 1), pageSize: "20" });
      const data = await apiFetch<FeedPage>(`/api/community/posts?${params.toString()}`);
      setPage((prev) => ({
        ...data,
        items: [...prev.items, ...data.items.filter((p) => !prev.items.some((e) => e.id === p.id))],
      }));
    } catch {
      // Nätfel: nästa gång sentinellen syns försöker vi igen.
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, author, page.page]);

  if (items.length === 0) {
    return <EmptyState icon={<IconMessage size={32} />} title={emptyText} description="" />;
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-1" aria-label={t("postsGrid")}>
        {items.map((post) => (
          <li key={post.id}>
            <button
              type="button"
              onClick={() => setOpenId(post.id)}
              aria-label={t("openPost", { title: post.title })}
              className="relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-surface-overlay text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-holo-cyan"
            >
              <PostTile post={post} soldLabel={post.listingStatus && post.listingStatus !== "ACTIVE" ? tForum(LISTING_STATUS_KEYS[post.listingStatus]) : null} multipleLabel={t("multiplePhotos")} />
            </button>
          </li>
        ))}
      </ul>
      <Sentinel enabled={hasMore && !loading} onVisible={loadMore} />
      {openId && (
        <PostViewer
          items={items}
          openId={openId}
          title={authorName}
          closeLabel={t("closePosts")}
          personal={personal}
          hasMore={hasMore}
          loading={loading}
          onLoadMore={loadMore}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function PostTile({ post, soldLabel, multipleLabel }: { post: FeedItem; soldLabel: string | null; multipleLabel: string }) {
  const thumb = post.images[0]?.url ?? null;
  const price = post.listingKind && post.priceOre != null && post.priceOre > 0 && !soldLabel ? formatPrice(post.priceOre) : null;
  return (
    <>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        // Inlägg utan foto: texten själv är rutan, så rutnätet aldrig får hål.
        <span className="absolute inset-0 flex flex-col justify-end gap-1 p-3">
          <span className="line-clamp-4 font-display text-sm font-semibold leading-snug text-ink">
            {post.storeReport?.productLabel ?? post.title}
          </span>
          {post.storeReport && (
            <span className="truncate text-xs text-ink-muted">{post.storeReport.store.name}</span>
          )}
        </span>
      )}
      {post.images.length > 1 && (
        <span className="absolute right-2 top-2 text-white drop-shadow" aria-label={multipleLabel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="7" y="7" width="13" height="13" rx="2" />
            <path d="M4 16V6a2 2 0 0 1 2-2h10" />
          </svg>
        </span>
      )}
      {(soldLabel || price) && (
        <span className="absolute bottom-2 left-2 rounded-full bg-surface/80 px-2 py-0.5 text-xs font-semibold text-ink backdrop-blur">
          {soldLabel ?? price}
        </span>
      )}
    </>
  );
}

function Sentinel({ enabled, onVisible }: { enabled: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          onVisible();
        }
      },
      // Roten är viewporten även i vyn: den fasta ytan täcker den, och en sentinel
      // som skrollats bort i vyns behållare räknas som utanför.
      { rootMargin: "400px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [enabled, onVisible]);
  return <div ref={ref} aria-hidden="true" />;
}

function PostViewer({
  items,
  openId,
  title,
  closeLabel,
  personal,
  hasMore,
  loading,
  onLoadMore,
  onClose,
}: {
  items: FeedItem[];
  openId: string;
  title: string;
  closeLabel: string;
  personal: ReturnType<typeof useForumViewer>;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onClose: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => setMounted(true), []);

  // Bakåt stänger vyn, inte profilen.
  const closedByHistory = useRef(false);
  useEffect(() => {
    window.history.pushState({ foilioPostViewer: true }, "", window.location.href);
    const onPop = () => {
      closedByHistory.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const state = window.history.state as { foilioPostViewer?: boolean } | null;
      if (!closedByHistory.current && state?.foilioPostViewer) window.history.back();
    };
  }, []);

  const requestClose = () => {
    const state = window.history.state as { foilioPostViewer?: boolean } | null;
    if (state?.foilioPostViewer) window.history.back();
    else onClose();
  };

  // Öppna vid det valda inlägget, utan animering — som att trycka in i flödet.
  useLayoutEffect(() => {
    if (!mounted) return;
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[id="post-${CSS.escape(openId)}"]`);
    if (box && el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[45] flex flex-col bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-border px-2.5 py-2">
        <CircleButton label={closeLabel} onClick={requestClose}>
          <IconChevronLeft size={20} />
        </CircleButton>
        <h2 className="min-w-0 truncate font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <ul className="mx-auto max-w-xl space-y-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {items.map((post) => (
            <PostCard key={post.id} post={post} showGroup visual personal={personal} onProfile />
          ))}
        </ul>
        <Sentinel enabled={hasMore && !loading} onVisible={onLoadMore} />
      </div>
    </div>,
    document.body
  );
}
