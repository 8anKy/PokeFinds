/**
 * /nyheter — "Senaste nytt".
 *
 * ⛔ SIDAN RÖR ALDRIG DATABASEN. Flödet ligger som en JSON-fil på Railway-volymen
 *    (src/lib/feed-store.ts); den enda läsningen är en filläsning bakom
 *    `cachedRead`. Lägg aldrig till en `prisma`-fråga här — nyhetslistan öppnas
 *    av varje besökare och en Neon-väckning kostar minst 300 s debiterad tid.
 */
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { getFeed } from "@/lib/feed-store";
import { FeedSwitch } from "@/components/features/feed/feed-chrome";
import { NewsList } from "@/components/features/feed/news-list";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "News" });
  return {
    title: t("metaNewsTitle"),
    description: t("metaNewsDescription"),
    alternates: alternatesFor(params.locale, "/nyheter"),
    openGraph: {
      ...baseOpenGraph(params.locale),
      title: t("metaNewsTitle"),
      description: t("metaNewsDescription"),
    },
  };
}

export default async function NewsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations("News");
  const feed = await getFeed();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-2.5 py-4 sm:px-6 sm:py-6">
      <h1 className="sr-only">{t("tabNews")}</h1>
      <FeedSwitch active="news" />
      <NewsList items={feed.news} />
    </div>
  );
}
