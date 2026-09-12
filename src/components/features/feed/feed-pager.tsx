"use client";

import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { EventsList } from "@/components/features/feed/events-list";
import { NewsList } from "@/components/features/feed/news-list";
import type { EventItem, NewsItem } from "@/lib/feed";

type FeedTab = "news" | "events";

const TAB_PATH: Record<FeedTab, string> = { news: "/nyheter", events: "/evenemang" };

function tabFromPathname(pathname: string): FeedTab | null {
  if (pathname === "/evenemang") return "events";
  if (pathname === "/nyheter") return "news";
  return null;
}

/**
 * Flödets två lägen delar den redan serverrenderade JSON-läsningen. Växlaren
 * byter bara innehåll vid tryck: inga sidledsdrag konkurrerar med läsning och
 * vanlig scroll i den långa listan.
 *
 * ⛔ FLIKEN MÅSTE SYNAS I URL:EN (2026-09-12). Växlingen var bara React-state:
 * /nyheter → fliken Evenemang → ett evenemang → bakåtsvep landade på /nyheter,
 * som renderar `initial="news"` — "Senaste nytt" i stället för listan man kom
 * ifrån. Därför `history.replaceState` till syskonvägen vid varje byte (ingen
 * navigering, ingen RSC-hämtning, en historikpost) och fliken LÄSES ur
 * pathname, så att bakåt till /evenemang visar evenemangen oavsett vilken
 * sidas träd Next återställer. `null` som state med flit — Next 14.2 synkar
 * bara `usePathname` när anropet inte redan bär dess egna markörer.
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
  const pathname = usePathname();
  const [active, setActive] = useState<FeedTab>(() => tabFromPathname(pathname) ?? initial);

  useEffect(() => {
    const fromUrl = tabFromPathname(pathname);
    if (fromUrl) setActive(fromUrl);
  }, [pathname]);

  const onChange = (next: FeedTab) => {
    setActive(next);
    if (typeof window === "undefined") return;
    const { pathname: here, search, hash } = window.location;
    const target = here.replace(/\/(?:nyheter|evenemang)$/, TAB_PATH[next]);
    if (target !== here) window.history.replaceState(null, "", `${target}${search}${hash}`);
  };

  return (
    <div className="px-2.5 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <FeedSwitch active={active} onChange={onChange} />
        <div key={active} className="animate-fade-in">
          {active === "news" ? <NewsList items={news} /> : <EventsList items={events} />}
        </div>
      </div>
    </div>
  );
}
