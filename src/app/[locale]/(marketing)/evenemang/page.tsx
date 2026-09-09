/**
 * /evenemang — mässor, prereleases och turneringar.
 *
 * ⛔ Samma regel som /nyheter: ingen databas, bara flödesfilen på volymen.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { getFeed } from "@/lib/feed-store";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { EventsList } from "@/components/features/feed/events-list";
import { FeedHidden } from "@/components/features/feed/feed-hidden";
import { newsFeedPublic } from "@/lib/news-feed-gate";

export const revalidate = 3600;

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
  const t = await getTranslations("News");
  const feed = await getFeed();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-2.5 py-4 sm:px-6 sm:py-6">
      <h1 className="sr-only">{t("tabEvents")}</h1>
      <FeedSwitch active="events" />
      <EventsList items={feed.events} />
    </div>
  );
}
