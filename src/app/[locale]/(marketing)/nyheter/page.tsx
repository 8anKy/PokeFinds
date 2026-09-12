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
  // ⛔ Dold yta ⇒ noindex, och metadatan får inte röja innehållet.
  if (!newsFeedPublic()) {
    const tNotFound = await getTranslations({ locale: params.locale, namespace: "NotFound" });
    return { title: tNotFound("title"), robots: { index: false, follow: false } };
  }
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
  // ⛔ Ytan är inte färdig (ägarbeslut) — se lib/news-feed-gate.ts. Grinden ligger
  //    FÖRE läsningen: en dold sida ska inte ens röra flödesfilen.
  if (!newsFeedPublic()) return <FeedHidden />;
  const feed = await getFeed();

  return (
    <SwipeBack fallback="/produkter">
      <FeedPager initial="news" news={feed.news} events={feed.events} />
    </SwipeBack>
  );
}
