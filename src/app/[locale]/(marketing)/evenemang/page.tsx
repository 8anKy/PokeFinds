/**
 * /evenemang — mässor, prereleases och turneringar.
 *
 * ⛔ Samma regel som /nyheter: ingen databas, bara flödesfilen på volymen.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { getFeed } from "@/lib/feed-store";
import { FeedPager } from "@/components/features/feed/feed-pager";
import { FeedHidden } from "@/components/features/feed/feed-hidden";
import { newsFeedPublic } from "@/lib/news-feed-gate";
import { SwipeBack } from "@/components/ui/swipe-back";

export const revalidate = 3600;

// ⛔ ALDRIG PRERENDER VID BYGGET (2026-09-11): `next build` kör utan Railway-volymen,
// så `getFeed()` gav ett tomt flöde och den tomma sidan bakades in i bygget —
// cache-handlerns seed-lager serverade den efter VARJE deploy tills ISR-timmen
// löpt ut ("Inga nyheter just nu" med sju godkända poster i feed.json). Tom
// `generateStaticParams` behåller ISR men flyttar första renderingen till runtime.
// Samma fälla och samma fix som forumets bilder 2026-09-07.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "News" });
  if (!newsFeedPublic()) {
    const tNotFound = await getTranslations({ locale: params.locale, namespace: "NotFound" });
    return { title: tNotFound("title"), robots: { index: false, follow: false } };
  }
  return {
    title: t("metaEventsTitle"),
    description: t("metaEventsDescription"),
    alternates: alternatesFor(params.locale, "/evenemang"),
    openGraph: {
      ...baseOpenGraph(params.locale),
      title: t("metaEventsTitle"),
      description: t("metaEventsDescription"),
    },
  };
}

export default async function EventsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  if (!newsFeedPublic()) return <FeedHidden />;
  const feed = await getFeed();

  return (
    <SwipeBack fallback="/produkter" coverViewport viewportInset="safe">
      <FeedPager initial="events" news={feed.news} events={feed.events} />
    </SwipeBack>
  );
}
