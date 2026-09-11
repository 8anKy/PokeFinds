"use client";

import { useState } from "react";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { EventsList } from "@/components/features/feed/events-list";
import { NewsList } from "@/components/features/feed/news-list";
import type { EventItem, NewsItem } from "@/lib/feed";

type FeedTab = "news" | "events";

/**
 * Flödets två lägen delar den redan serverrenderade JSON-läsningen. Växlaren
 * byter bara innehåll vid tryck: inga sidledsdrag konkurrerar med läsning och
 * vanlig scroll i den långa listan.
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
  const [active, setActive] = useState<FeedTab>(initial);

  return (
    <div className="px-2.5 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <FeedSwitch active={active} onChange={setActive} />
        <div key={active} className="animate-fade-in">
          {active === "news" ? <NewsList items={news} /> : <EventsList items={events} />}
        </div>
      </div>
    </div>
  );
}
