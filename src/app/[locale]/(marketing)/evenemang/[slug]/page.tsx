/**
 * /evenemang/[slug] — ett evenemang.
 *
 * ⛔ Ingen databas: posten hämtas ur flödesfilen på volymen (se src/lib/feed.ts).
 * ⛔ `generateStaticParams` returnerar `[]` med flit — inget prerenderas vid
 *    bygget. Sidorna byggs vid första besöket och ISR-cachas; ett bygge som
 *    prerenderar allt hade bakat in ett flöde som kan vara veckor gammalt när
 *    volymen sedan får en ny fil.
 *
 * Formen är produktvyns "hjälte" (ägarbeslut 2026-09-05): bilden är en scen över
 * hela bredden med en flytande bakåtcirkel, och innehållet ligger i ett rundat ark
 * som glider upp över den. ⛔ Rutten MÅSTE stå i `lib/subpage-routes.ts` — annars
 * ligger logotyphuvudet kvar ovanför cirkeln på mobil.
 */
import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor, baseOpenGraph } from "@/lib/canonical";
import { getFeed } from "@/lib/feed-store";
import { formatEventRange } from "@/lib/event-format";
import { BackCircle } from "@/components/ui/back-circle";
import { IconCalendar, IconExternalLink, IconMapPin } from "@/components/ui/icons";
import { CategoryPill, FeedCover } from "@/components/features/feed/feed-chrome";
import { EventCountdown } from "@/components/features/feed/event-countdown";
import { EventShare } from "@/components/features/feed/event-share";

export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

async function findEvent(slug: string) {
  const feed = await getFeed();
  return feed.events.find((e) => e.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: "News" });
  const event = await findEvent(params.slug);
  if (!event) return { title: t("eventNotFound"), robots: { index: false, follow: false } };
  const description = event.summary || [event.venue, event.city].filter(Boolean).join(", ");
  return {
    title: event.title,
    description,
    alternates: alternatesFor(params.locale, `/evenemang/${event.slug}`),
    openGraph: {
      ...baseOpenGraph(params.locale),
      type: "article",
      title: event.title,
      description,
      ...(event.imageUrl ? { images: [{ url: event.imageUrl }] } : {}),
    },
  };
}

export default async function EventPage({ params }: { params: { locale: string; slug: string } }) {
  setRequestLocale(params.locale);
  const event = await findEvent(params.slug);
  const t = await getTranslations("News");

  // ⛔ INGEN `notFound()` HÄR, och det är MÄTT (2026-09-09): Next renderar den här
  //    rutten statiskt (revalidate + tom `generateStaticParams`, precis som
  //    /produkter/[slug] och /sets/[id]), och rot-`not-found.tsx` hämtar sin copy med
  //    `getTranslations()` UTAN locale — alltså ur headers. Under statisk rendering
  //    fäller Next hela svaret: "Page changed from static to dynamic at runtime,
  //    reason: headers" ⇒ HTTP **500** på varje död slug, om och om igen eftersom
  //    ingenting cachas. Den mjuka 404:an nedan svarar 200 med `noindex` — exakt
  //    samma beteende som syskonrutterna redan har (utrett och medvetet olagat, se
  //    CLAUDE.md "MJUK 404 PÅ ISR-RUTTERNA"). Skadan är crawl-budget, aldrig
  //    indexerat skräp.
  if (!event) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-2.5 py-20 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t("eventNotFound")}</h1>
        <p className="max-w-sm text-sm text-ink-muted">{t("eventNotFoundBody")}</p>
        {/* ⛔ VANLIG `<a>`, INTE next-intls `Link` — ORSAKEN TILL 500:AN, MÄTT 2026-09-09.
            En serverrenderad `Link` från `@/i18n/navigation` slår upp locale via
            `requestLocale`, dvs ur HEADERS. Under statisk rendering fäller Next då hela
            svaret ("Page changed from static to dynamic at runtime, reason: headers") och
            varje död slug blev HTTP 500 i stället för en mjuk 404. Prefixet sätts därför
            ur `params.locale`, som vi redan har. (I klientkomponenter är `Link` oproblematisk
            — det är bara serverrenderingen som läser headers.) */}
        <a
          href={params.locale === "sv" ? "/evenemang" : `/${params.locale}/evenemang`}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-surface-border bg-surface-overlay px-4 text-sm font-semibold text-ink"
        >
          {t("tabEvents")}
        </a>
      </div>
    );
  }

  const locale = await getLocale();
  const place = [event.venue, event.address].filter(Boolean).join(" · ");
  const cta = event.ticketUrl ?? event.infoUrl;

  return (
    <article className="pb-8">
      {/* Scenen */}
      <FeedCover src={event.imageUrl} alt="" category={event.category} className="h-56 w-full sm:h-72">
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />
        <div className="absolute left-2.5 top-2 flex w-[calc(100%_-_1.25rem)] items-center justify-between sm:left-6 sm:w-[calc(100%_-_3rem)]">
          <BackCircle fallback="/evenemang" />
          <EventShare title={event.title} />
        </div>
      </FeedCover>

      {/* Arket */}
      <div className="relative mx-auto -mt-5 max-w-3xl rounded-t-[20px] bg-surface px-2.5 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill category={event.category} />
          <EventCountdown startsAt={event.startsAt} />
        </div>

        <h1 className="mt-3 text-pretty text-[28px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">{event.title}</h1>

        {event.summary && <p className="mt-3 text-pretty text-[15px] leading-relaxed text-ink-muted">{event.summary}</p>}

        {/* Fakta: datum och plats. Kartan öppnas hos kartleverantören — vi bäddar
            aldrig in en karta (kostar pengar och spårar besökaren). */}
        <dl className="card-surface mt-5 divide-y divide-surface-border">
          <div className="flex items-center gap-3 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-holo-violet/12 text-holo-violet">
              <IconCalendar size={18} />
            </span>
            <div className="min-w-0">
              <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{t("labelDate")}</dt>
              <dd className="text-pretty text-[15px] font-medium tabular-nums text-ink">{formatEventRange(event, locale)}</dd>
            </div>
          </div>
          {(place || event.city) && (
            <div className="flex items-center gap-3 p-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-holo-violet/12 text-holo-violet">
                <IconMapPin size={18} />
              </span>
              <div className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">{t("labelPlace")}</dt>
                <dd className="text-pretty text-[15px] font-medium text-ink">{place || event.city}</dd>
              </div>
              {event.mapUrl && (
                <a
                  href={event.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-holo-cyan"
                >
                  {t("map")}
                  <IconExternalLink size={14} />
                </a>
              )}
            </div>
          )}
        </dl>

        {event.body.length > 0 && (
          <div className="mt-6 flex flex-col gap-3">
            {event.body.map((block, i) =>
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
        )}

        {event.organizer && (
          <p className="mt-6 text-xs leading-relaxed text-ink-faint">{t("organizerNote", { organizer: event.organizer })}</p>
        )}

        {cta && (
          // Sticky ovanför bottenflikarna på mobil (de är fixed, h-16 + safe area).
          <div className="sticky bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] z-10 mt-6 lg:bottom-6">
            <a
              href={cta}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-holo-cyan px-5 py-4 text-[15px] font-bold text-black shadow-glow transition-colors duration-150 hover:bg-holo-cyan/90"
            >
              {event.ticketUrl ? t("tickets") : t("moreInfo")}
              <IconExternalLink size={16} />
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
