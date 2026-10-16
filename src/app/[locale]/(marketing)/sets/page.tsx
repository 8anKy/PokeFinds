import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
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
  const sets = await loadSetsGallery();

  return (
    <div>
      <div className="mx-auto max-w-screen-2xl px-2.5 py-8 sm:px-6 lg:py-10">
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">{t("h1")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("intro")}</p>

        {sets.length === 0 ? (
          <EmptyState className="mt-8" icon={<IconCards size={32} />} title={t("emptyTitle")} description={t("emptyDesc")} />
        ) : (
          <SetsGallery sets={sets} />
        )}
      </div>
    </div>
  );
}
