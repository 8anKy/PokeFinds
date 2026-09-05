import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconChevronLeft } from "@/components/ui/icons";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { Composer } from "@/components/community/composer";

/**
 * Ny tråd. Middleware kräver inloggning för /forum/ny; sidan själv är ett tunt
 * skal runt klientkomponisten (ingen server-auth(), ingen DB — grupperna hämtas
 * av klienten). searchParams gör sidan dynamisk, vilket är rätt här.
 */
interface PageProps {
  params: { locale: string };
  searchParams: { group?: string | string[] };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Forum" });
  return { title: t("composerTitle"), robots: { index: false, follow: false } };
}

export default async function NewThreadPage({ params, searchParams }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Forum");
  const initialGroup = typeof searchParams.group === "string" ? searchParams.group : undefined;

  return (
    <div className="mx-auto w-full max-w-2xl px-2.5 py-6 sm:px-6">
      <SubpageHeader href="/forum" title={t("composerTitle")} subtitle={t("h1")} mobileOnly />
      <Link
        href="/forum"
        className="hidden items-center gap-1 text-sm text-ink-muted hover:text-holo-cyan lg:inline-flex"
      >
        <IconChevronLeft size={16} />
        {t("h1")}
      </Link>
      <h1 className="hidden font-display text-3xl font-bold text-ink lg:mt-3 lg:block">{t("composerTitle")}</h1>
      <div className="mt-6">
        <Composer initialGroup={initialGroup} />
      </div>
    </div>
  );
}
