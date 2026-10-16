import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { loadSetsGallery } from "@/services/sets-gallery";
import { SetsGallery } from "@/components/features/sets-gallery";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCards } from "@/components/ui/icons";

// Katalogdata ändras ~en gång/dygn → cacha (ISR). Sparar Vercel CPU + Neon-läsningar.
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "Sets" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(params.locale, "/sets"),
  };
}

export default async function SetsPage({
  params,
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations("Sets");
  const locale = await getLocale();
  const sets = await loadSetsGallery();

  return (
    <div className="mx-auto max-w-6xl px-2.5 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-ink-muted">
        {t("intro")}
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        <a
          href={`${locale === "en" ? "/en" : ""}/guider/kommande-pokemon-set`}
          className="font-medium text-holo-cyan hover:underline"
        >
          {t("upcomingGuide")}
        </a>
        <span aria-hidden="true"> · </span>
        <a
          href={`${locale === "en" ? "/en" : ""}/guider/var-koper-man-billiga-pokemonkort`}
          className="font-medium text-holo-cyan hover:underline"
        >
          {t("buyingGuide")}
        </a>
      </p>

      {sets.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<IconCards size={32} />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
        />
      ) : (
        <SetsGallery sets={sets} />
      )}
    </div>
  );
}
