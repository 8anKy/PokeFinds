import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { communityV2Request } from "@/lib/community-v2-server";
import { IconChevronLeft } from "@/components/ui/icons";
import { SwipeBack } from "@/components/ui/swipe-back";
import { SavedThreads } from "@/components/community/saved-threads";
import { getLikedFeed, getSavedFeed } from "@/services/community";

/**
 * "Sparade" — dit Spara- och Gilla-knapparna leder. Personlig ⇒ dynamisk med
 * auth(); middleware skickar utloggade till inloggningen (PROTECTED_PREFIXES)
 * och grinden gäller som för resten av forumet. Aldrig i sitemapen.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "Forum",
  });
  return { title: t("savedTitle"), robots: { index: false, follow: false } };
}

export default async function SavedThreadsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  if (!(await communityV2Request(session.user.role))) notFound();

  const [t, saved, liked] = await Promise.all([
    getTranslations("Forum"),
    getSavedFeed(session.user.id, 1, 20),
    getLikedFeed(session.user.id, 1, 20),
  ]);

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
        <h1 className="mt-3 font-display text-3xl font-bold text-ink">{t("savedTitle")}</h1>
        <div className="mt-4">
          <SavedThreads saved={saved} liked={liked} />
        </div>
      </div>
    </SwipeBack>
  );
}
