/**
 * /nyheter/[slug] — en nyhet vi skrivit egen text om.
 *
 * ⛔ BARA POSTER MED EGEN TEXT HAR EN SIDA HÄR. En hämtad RSS-post får aldrig en
 *    `slug`: vi äger inte artikeln och skulle bara ha en rubrik att fylla sidan
 *    med. Den raden går direkt till källan. Se `src/lib/feed.ts`.
 * ⛔ SIST PÅ SIDAN LIGGER LÄNKEN TILL ORIGINALET, alltid när posten har en extern
 *    källa. Det är hela villkoret för att få sammanfatta någon annans nyhet: vår
 *    text, deras namn, deras länk.
 * ⛔ Ingen databas — posten hämtas ur flödesfilen på volymen.
 * ⛔ INGEN `notFound()`, se kommentaren i evenemangens motsvarighet: rutten
 *    renderas statiskt och rot-`not-found.tsx` läser locale ur headers, vilket
 *    gav HTTP 500 på varje död slug.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { getFeed } from "@/lib/feed-store";
import { newsFeedPublic } from "@/lib/news-feed-gate";
import { FeedHidden } from "@/components/features/feed/feed-hidden";
import { formatDate } from "@/lib/format";
import { BackCircle } from "@/components/ui/back-circle";
import { IconArrowRight, IconExternalLink } from "@/components/ui/icons";
import { CategoryPill, FeedCover } from "@/components/features/feed/feed-chrome";
import { EventShare } from "@/components/features/feed/event-share";

export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

async function findNews(slug: string) {
  const feed = await getFeed();
  return feed.news.find((n) => n.slug === slug && n.body.length > 0) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: "News" });
  // ⛔ Dold yta ⇒ noindex och ingen titel som röjer innehållet.
  if (!newsFeedPublic()) {
    const tNotFound = await getTranslations({ locale: params.locale, namespace: "NotFound" });
    return { title: tNotFound("title"), robots: { index: false, follow: false } };
  }
  const item = await findNews(params.slug);
  if (!item) return { title: t("newsNotFound"), robots: { index: false, follow: false } };
  return {
    title: item.title,
    description: item.summary,
    alternates: alternatesFor(params.locale, `/nyheter/${item.slug}`),
    openGraph: {
      ...baseOpenGraph(params.locale),
      type: "article",
      title: item.title,
      description: item.summary,
      ...(item.imageUrl?.startsWith("http") ? { images: [{ url: item.imageUrl }] } : {}),
    },
  };
}

export default async function NewsArticlePage({ params }: { params: { locale: string; slug: string } }) {
  setRequestLocale(params.locale);
  // ⛔ Ytan är inte färdig — se lib/news-feed-gate.ts.
  if (!newsFeedPublic()) return <FeedHidden />;
  const item = await findNews(params.slug);
  const t = await getTranslations("News");
  const locale = await getLocale();

  if (!item) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-2.5 py-20 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t("newsNotFound")}</h1>
        <p className="max-w-sm text-sm text-ink-muted">{t("newsNotFoundBody")}</p>
        {/* ⛔ Vanlig `<a>`, inte next-intls `Link` — en serverrenderad `Link` läser
            locale ur headers och fäller den statiska renderingen (se evenemangssidan). */}
        <a
          href={params.locale === "sv" ? "/nyheter" : `/${params.locale}/nyheter`}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-surface-border bg-surface-overlay px-4 text-sm font-semibold text-ink"
        >
          {t("tabNews")}
        </a>
      </div>
    );
  }

  const external = /^https?:\/\//i.test(item.url);

  return (
    <article className="pb-8">
      {/* Scenen — samma "hjälte" som produktvyn och evenemangssidan. */}
      <FeedCover src={item.imageUrl} alt="" category={item.category} fit={item.imageFit} className="h-56 w-full sm:h-72">
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
        <div className="absolute left-2.5 top-2 flex w-[calc(100%_-_1.25rem)] items-center justify-between sm:left-6 sm:w-[calc(100%_-_3rem)]">
          <BackCircle fallback="/nyheter" />
          <EventShare title={item.title} />
        </div>
      </FeedCover>

      <div className="relative mx-auto -mt-5 max-w-3xl rounded-t-[20px] bg-surface px-2.5 pt-4 sm:px-6">
        <CategoryPill category={item.category} />

        <h1 className="mt-3 text-pretty text-[28px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">{item.title}</h1>

        <p className="mt-2 text-xs tabular-nums text-ink-faint">
          {item.source} · {formatDate(item.publishedAt, locale)}
        </p>

        {item.summary && <p className="mt-4 text-pretty text-[17px] leading-relaxed text-ink">{item.summary}</p>}

        <div className="mt-5 flex flex-col gap-3">
          {item.body.map((block, i) =>
            block.type === "h" ? (
              <h2 key={i} className="mt-3 text-pretty text-lg font-bold leading-snug tracking-[-0.01em] text-ink">
                {block.text}
              </h2>
            ) : (
              <p key={i} className="text-pretty text-[15px] leading-relaxed text-ink-muted">
                {block.text}
              </p>
            )
          )}
        </div>

        {/* Källan sist: vår text, deras namn, deras länk. */}
        <a
          href={item.url}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="mt-8 flex items-center gap-3 rounded-2xl border border-surface-border bg-surface-overlay p-4 transition-colors duration-150 hover:border-holo-cyan/40"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
              {external ? t("sourceLabel") : t("openInAppLabel")}
            </div>
            <div className="truncate text-[15px] font-semibold text-ink">{external ? item.source : t("openInApp")}</div>
          </div>
          {external ? (
            <IconExternalLink size={18} className="shrink-0 text-holo-cyan" />
          ) : (
            <IconArrowRight size={18} className="shrink-0 text-holo-cyan" />
          )}
        </a>
      </div>
    </article>
  );
}
