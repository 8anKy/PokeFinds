"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { EventsList } from "@/components/features/feed/events-list";
import { NewsList } from "@/components/features/feed/news-list";
import { EDGE_ZONE_PX, resolveTabSwipe } from "@/lib/swipe-gesture";
import { cn } from "@/lib/utils";
import type { EventItem, NewsItem } from "@/lib/feed";

type FeedTab = "news" | "events";
type Drag = { x: number; width: number };

/**
 * Två listor, en mobilvy. Nyheter → evenemang är ett vänstersvep. Evenemang →
 * nyheter är ett högersvep. Först när nyheter redan visas får ett nytt
 * högersvep från VÄNSTERKANTEN lämna flödet. En enda gest äger alltså fingret.
 */
export function FeedPager({
  initial,
  news,
  events,
}: {
  initial: FeedTab;
  news: NewsItem[];
  events: EventItem[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<FeedTab>(initial);
  const [drag, setDrag] = useState<Drag | null>(null);
  const start = useRef<{ x: number; y: number; t: number; width: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const select = (next: FeedTab) => {
    dragRef.current = null;
    setDrag(null);
    setActive(next);
  };

  const leaveFeed = () => {
    if (window.history.length > 1) router.back();
    else router.push("/produkter");
  };

  const activeIndex = active === "news" ? 0 : 1;
  const indicatorPosition = drag
    ? Math.max(0, Math.min(1, activeIndex - drag.x / drag.width))
    : activeIndex;

  return (
    <div
      className="overflow-hidden touch-pan-y"
      onTouchStart={(event) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        start.current = {
          x: touch.clientX,
          y: touch.clientY,
          t: event.timeStamp,
          width: event.currentTarget.clientWidth || 1,
        };
        axis.current = null;
        dragRef.current = null;
      }}
      onTouchMove={(event) => {
        const origin = start.current;
        if (!origin) return;
        const dx = event.touches[0].clientX - origin.x;
        const dy = event.touches[0].clientY - origin.y;
        if (!axis.current) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          axis.current = Math.abs(dx) > Math.abs(dy) * 1.35 ? "x" : "y";
        }
        if (axis.current !== "x") return;

        const canMoveToEvents = active === "news" && dx < 0;
        const canMoveToNews = active === "events" && dx > 0;
        const canLeave = active === "news" && origin.x <= EDGE_ZONE_PX && dx > 0;
        if (!canMoveToEvents && !canMoveToNews && !canLeave) return;

        event.preventDefault();
        const next = { x: dx, width: origin.width };
        dragRef.current = next;
        setDrag(next);
      }}
      onTouchEnd={(event) => {
        const origin = start.current;
        const released = dragRef.current;
        start.current = null;
        axis.current = null;
        dragRef.current = null;
        if (!origin || !released) {
          setDrag(null);
          return;
        }
        const direction = resolveTabSwipe({
          dx: released.x,
          width: released.width,
          velocityPxPerMs: released.x / Math.max(1, event.timeStamp - origin.t),
          canPrev: active === "events" || (active === "news" && origin.x <= EDGE_ZONE_PX),
          canNext: active === "news",
        });
        setDrag(null);
        if (direction === 0) return;
        if (active === "news" && direction > 0) select("events");
        else if (active === "events" && direction < 0) select("news");
        else if (active === "news" && direction < 0) leaveFeed();
      }}
      onTouchCancel={() => {
        start.current = null;
        axis.current = null;
        dragRef.current = null;
        setDrag(null);
      }}
    >
      <div
        className={cn("flex will-change-transform", drag == null && "transition-transform duration-300 ease-out")}
        style={{ transform: `translateX(calc(${activeIndex === 0 ? 0 : -100}% + ${drag?.x ?? 0}px))` }}
      >
        <section className="w-full shrink-0 px-2.5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <FeedSwitch active={active} onChange={select} indicatorPosition={indicatorPosition} />
            <NewsList items={news} />
          </div>
        </section>
        <section className="w-full shrink-0 px-2.5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <FeedSwitch active={active} onChange={select} indicatorPosition={indicatorPosition} />
            <EventsList items={events} />
          </div>
        </section>
      </div>
    </div>
  );
}
