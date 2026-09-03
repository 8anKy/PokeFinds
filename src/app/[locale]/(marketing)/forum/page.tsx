import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternatesFor } from "@/lib/canonical";
import { LinkButton } from "@/components/ui/button";
import { IconMail, IconPlus } from "@/components/ui/icons";
import { UnreadBadge } from "@/components/chat/unread-badge";
import { GroupChips } from "@/components/community/group-chips";
import { ThreadList } from "@/components/community/thread-list";
import { getFeed } from "@/services/community";
import { listGroups } from "@/services/community-groups";

/**
 * Forumets startflöde. ISR (5 min) + revalidatePath vid varje skrivning —
 * ingen auth()/cookies() här (per-viewer-tillstånd hämtas klient-sida via
 * /api/community/me). Grinden (vem som får se forumet) sköter middleware
 * FÖRE cachen.
 */
export const revalidate = 300;

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
  const [groups, feed] = await Promise.all([listGroups(), getFeed({ page: 1, pageSize: 20 })]);

  return (
    <div className="mx-auto w-full max-w-3xl px-2.5 py-6 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/meddelanden"
            aria-label={t("messages")}
            className="relative grid h-10 w-10 place-items-center rounded-full border border-surface-border text-ink-muted transition-colors hover:border-holo-cyan/40 hover:text-holo-cyan"
          >
            <IconMail size={18} />
            <span className="absolute -right-1 -top-1">
              <UnreadBadge />
            </span>
          </Link>
          <LinkButton href="/forum/ny" size="sm">
            <IconPlus size={16} />
            {t("newThread")}
          </LinkButton>
        </div>
      </header>

      <div className="mt-5">
        <GroupChips groups={groups} />
      </div>

      <div className="mt-5">
        <ThreadList initial={feed} emptyText={t("emptyFeed")} />
      </div>
    </div>
  );
}
