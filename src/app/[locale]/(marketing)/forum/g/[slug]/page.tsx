import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternatesFor } from "@/lib/canonical";
import { localizeGroup } from "@/lib/community-group-i18n";
import { LinkButton } from "@/components/ui/button";
import { IconChevronLeft, IconPlus } from "@/components/ui/icons";
import { SwipeBack } from "@/components/ui/swipe-back";
import { GroupChips } from "@/components/community/group-chips";
import { JoinGroupButton } from "@/components/community/join-group-button";
import { ThreadList } from "@/components/community/thread-list";
import { getFeed } from "@/services/community";
import { getGroupBySlug, listGroups } from "@/services/community-groups";

export const revalidate = 300;

// Tom lista → inget prerenderas vid build; KRÄVS för att segmentet ska ISR-cachas
// (utan generateStaticParams renderas dynamiska segment per request trots revalidate).
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: { locale: string; slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const [t, tGroups, raw] = await Promise.all([
    getTranslations({ locale: params.locale, namespace: "Forum" }),
    getTranslations({ locale: params.locale, namespace: "ForumGroups" }),
    getGroupBySlug(params.slug),
  ]);
  if (!raw) return { title: t("groupNotFound") };
  const group = localizeGroup(raw, tGroups);
  return {
    title: t("groupMetaTitle", { name: group.name }),
    description: group.description,
    alternates: alternatesFor(params.locale, `/forum/g/${params.slug}`),
  };
}

export default async function GroupPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const [t, tGroups, groups, raw] = await Promise.all([
    getTranslations("Forum"),
    getTranslations("ForumGroups"),
    listGroups(),
    getGroupBySlug(params.slug),
  ]);
  if (!raw) notFound();
  // Namn + beskrivning följer språket; DB-värdet är svenskt.
  const group = localizeGroup(raw, tGroups);
  const feed = await getFeed({ groupSlug: group.slug, page: 1, pageSize: 20 });

  return (
    <SwipeBack fallback="/forum">
      <div className="mx-auto w-full max-w-3xl px-2.5 py-6 sm:px-6">
      <Link
        href="/forum"
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-holo-cyan"
      >
        <IconChevronLeft size={16} />
        {t("h1")}
      </Link>

      <header className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">{group.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{group.description}</p>
          <p className="mt-2 text-xs text-ink-faint">
            {t("members", { count: group.memberCount })} · {t("threads", { count: group.threadCount })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <JoinGroupButton slug={group.slug} groupId={group.id} />
          <LinkButton href={`/forum/ny?group=${encodeURIComponent(group.slug)}`} size="sm" variant="outline">
            <IconPlus size={16} />
            {t("newThread")}
          </LinkButton>
        </div>
      </header>

      {group.isMarketplace && (
        <p className="mt-4 rounded-xl border border-holo-cyan/30 bg-holo-cyan/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
          {t("marketplaceNotice")}
        </p>
      )}

      <div className="mt-5">
        <GroupChips groups={groups} activeSlug={group.slug} />
      </div>

      <div className="mt-5">
        <ThreadList
          initial={feed}
          group={group.slug}
          marketplace={group.isMarketplace}
          showGroup={false}
          emptyText={t("emptyGroup")}
        />
      </div>
      </div>
    </SwipeBack>
  );
}
