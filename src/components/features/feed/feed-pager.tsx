"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { EventsList } from "@/components/features/feed/events-list";
import { NewsList } from "@/components/features/feed/news-list";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { EDGE_ZONE_PX } from "@/lib/swipe-gesture";
import { cn } from "@/lib/utils";
import type { EventItem, NewsItem } from "@/lib/feed";

type FeedTab = "news" | "events";

/**
 * Två listor, en mobilvy. Båda listorna kom från samma serverrenderade ISR-läsning
 * och växlas bara i klienten: ett tryck eller svep PÅ lägesväxlaren får därför Instagram-känslan
 * utan ny route, ny laddning eller databasanrop.
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
  const t = useTranslations("News");
  const [active, setActive] = useState<FeedTab>(initial);
  const [dragX, setDragX] = useState<number | null>(null);
  const dragXRef = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);

  const select = (next: FeedTab) => {
    dragXRef.current = null;
    setDragX(null);
    setActive(next);
  };

  return (
    <div
      className="overflow-hidden touch-pan-y"
      onTouchStart={(event) => {
        if (event.touches.length !== 1) return;
        // Kort och listor måste alltid få vara just kort och listor. Att börja
        // växla hela flödet från deras yta gör ett lite snett lodrätt drag till
        // en oavsiktlig sidoförflyttning. Bara växlaren äger den här gesten;
        // vänsterkanten lämnas dessutom åt SwipeBack.
        if (
          event.touches[0].clientX <= EDGE_ZONE_PX ||
          !(event.target as HTMLElement).closest("[data-feed-switch]")
        ) {
          start.current = null;
          return;
        }
        start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        axis.current = null;
      }}
      onTouchMove={(event) => {
        if (!start.current) return;
        const dx = event.touches[0].clientX - start.current.x;
        const dy = event.touches[0].clientY - start.current.y;
        if (!axis.current) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          // Kräver en tydligt horisontell rörelse. På telefoner är ett normalt
          // scroll ofta några pixlar snett, särskilt nära den flytande tabbraden.
          axis.current = Math.abs(dx) > Math.abs(dy) * 1.35 ? "x" : "y";
        }
        if (axis.current !== "x") return;
        // Dra aldrig utanför de två lägena: nyheter ligger till vänster,
        // evenemang till höger.
        if ((active === "news" && dx > 0) || (active === "events" && dx < 0)) return;
        event.preventDefault();
        dragXRef.current = dx;
        setDragX(dx);
      }}
      onTouchEnd={() => {
        const releasedAt = dragXRef.current;
        if (releasedAt != null && Math.abs(releasedAt) > 56) {
          select(releasedAt < 0 ? "events" : "news");
        } else {
          dragXRef.current = null;
          setDragX(null);
        }
        start.current = null;
        axis.current = null;
      }}
      onTouchCancel={() => {
        dragXRef.current = null;
        setDragX(null);
        start.current = null;
        axis.current = null;
      }}
    >
      <div
        className={cn("flex will-change-transform", dragX == null && "transition-transform duration-300 ease-out")}
        style={{ transform: `translateX(calc(${active === "news" ? 0 : -100}% + ${dragX ?? 0}px))` }}
      >
        <section className="w-full shrink-0 px-2.5 py-4 sm:px-6 sm:py-6">
          <SubpageHeader title={t("tabNews")} fallback="/produkter" mobileOnly />
          <h1 className="sr-only">{t("tabNews")}</h1>
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <FeedSwitch active={active} onChange={select} />
            <NewsList items={news} />
          </div>
        </section>
        <section className="w-full shrink-0 px-2.5 py-4 sm:px-6 sm:py-6">
          <SubpageHeader title={t("tabEvents")} fallback="/produkter" mobileOnly />
          <h1 className="sr-only">{t("tabEvents")}</h1>
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <FeedSwitch active={active} onChange={select} />
            <EventsList items={events} />
          </div>
        </section>
      </div>
    </div>
  );
}
