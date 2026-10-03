import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { alternatesFor } from "@/lib/canonical";
import { LinkButton } from "@/components/ui/button";
import { IconBookmark, IconMail, IconPlus } from "@/components/ui/icons";
import { UnreadBadge } from "@/components/chat/unread-badge";
import { ThreadList } from "@/components/community/thread-list";
import { getFeed } from "@/services/community";
import { listGroups } from "@/services/community-groups";
import { listCommunityStores } from "@/services/community-stores";
import { CommunityHub } from "@/components/community/community-hub";

/**
 * Forumets startflöde. ISR (5 min) + revalidatePath vid varje skrivning —
 * ingen auth()/cookies() här (per-viewer-tillstånd hämtas klient-sida via
 * /api/community/me). Grinden (vem som får se forumet) sköter middleware
 * FÖRE cachen.
 */
export const revalidate = 300;

// ⛔ INGET PRERENDER VID BYGGET (2026-09-07) — tom lista, precis som gruppsidan.
// `next build` körs UTAN S3-env (Dockerfile skickar bara in det bygget behöver),
// så `storageEnabled()` är falskt där och `imageUrl()` ger null — den prerenderade
// HTML:en saknade DÄRFÖR bildtaggarna HELT, inte bara bilddatan. Cache-handlerns
// seed-lager (server/cache-handler.cjs, readSeed) serverar byggets fil efter varje
// deploy tills en runtime-render tagit över — med ~9 deployer/dygn försvann
// trådlistans bilder därför "ibland" och kom tillbaka av sig själva, medan tråden
// man öppnade (dynamiskt segment ⇒ aldrig prerenderad) alltid visade dem.
// Uppmätt 2026-09-07: `x-nextjs-cache: STALE` ⇒ 0 bild-URL:er, nästa svar `HIT`
// ⇒ 1. ⛔ Lös det ALDRIG genom att skicka in S3-hemligheterna som build-ARG:
// då bakas signerade URL:er in i en byggartefakt. Tom lista behåller ISR men
// flyttar första renderingen till runtime, där bilderna kan signeras — och där
// flödet dessutom är färskt i stället för byggets ögonblicksbild.
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Forum" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/forum"),
  };
}

export default async function ForumPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Forum");
  const [groups, feed, stores] = await Promise.all([listGroups(), getFeed({ page: 1, pageSize: 20 }), listCommunityStores()]);

  return (
    <div className="mx-auto w-full max-w-2xl px-2.5 py-2 sm:px-6 sm:py-4">
      {/* Bara rubriken — ingen ingress (ägarbeslut 2026-09-03: "onödig text"). */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 font-display text-2xl font-bold text-ink">{t("h1")}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Dit Spara/Gilla leder — knapparna på tråden pekar hit i sin toast. */}
          <a
            href={`/${params.locale}/forum/sparade`}
            aria-label={t("savedLink")}
            title={t("savedLink")}
            className="grid h-10 w-10 place-items-center rounded-full border border-surface-border text-ink-muted transition-colors hover:border-holo-cyan/40 hover:text-holo-cyan"
          >
            <IconBookmark size={18} />
          </a>
          <a
            href={`/${params.locale}/meddelanden`}
            aria-label={t("messages")}
            className="relative grid h-10 w-10 place-items-center rounded-full border border-surface-border text-ink-muted transition-colors hover:border-holo-cyan/40 hover:text-holo-cyan"
          >
            <IconMail size={18} />
            <span className="absolute -right-1 -top-1">
              <UnreadBadge />
            </span>
          </a>
          <LinkButton href="/forum/ny" size="sm" aria-label={t("newThread")}>
            <IconPlus size={16} />
            <span className="hidden sm:inline">{t("newThread")}</span>
          </LinkButton>
        </div>
      </header>

      <div className="mt-3">
        <Suspense fallback={<ThreadList initial={feed} emptyText={t("emptyFeed")} />}>
          <CommunityHub initial={feed} groups={groups} stores={stores} />
        </Suspense>
      </div>
    </div>
  );
}
