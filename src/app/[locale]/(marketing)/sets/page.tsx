import type { Metadata } from "next";
import { alternatesFor } from "@/lib/canonical";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCards, IconChevronRight } from "@/components/ui/icons";

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
  const sets = await prisma.cardSet.findMany({
    // Setgalleriet är ENGELSKT tills vidare. Japanska set finns i katalogfiltret
    // (flik "Japanska") men har varken logotyp eller kortrader — de hade ritats
    // som tomma brickor med "0 kort" här. Sidorna /sets/{id} fungerar ändå.
    where: { language: "EN" },
    include: { _count: { select: { cards: true, products: true } } },
    // nulls: "last" — annars lägger Postgres datumlösa set FÖRST vid DESC, alltså
    // som om de vore nyast (samma regel som filtrets set-lista).
    orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
  });

  // Gruppera per serie för en tydligare överblick än ett platt kort-grid
  const seriesOrder: string[] = [];
  const bySeries = new Map<string, typeof sets>();
  for (const set of sets) {
    if (!bySeries.has(set.series)) {
      bySeries.set(set.series, []);
      seriesOrder.push(set.series);
    }
    bySeries.get(set.series)!.push(set);
  }

  return (
    <div className="mx-auto max-w-5xl px-2.5 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">{t("h1")}</h1>
      <p className="mt-2 text-ink-muted">
        {t("intro")}
      </p>

      {sets.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<IconCards size={32} />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
        />
      ) : (
        <div className="mt-8 space-y-10">
          {seriesOrder.map((series) => (
            <section key={series}>
              <h2 className="font-display text-lg font-semibold text-ink">{series}</h2>
              <ul className="card-surface mt-3 divide-y divide-surface-border">
                {bySeries.get(series)!.map((set) => (
                  <li key={set.id}>
                    <Link
                      href={`/sets/${set.id}`}
                      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-overlay/60 active:bg-surface-overlay sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink group-hover:text-holo-cyan">
                          {set.name}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {t("release", { date: formatDate(set.releaseDate) })}
                        </p>
                      </div>
                      <p className="hidden shrink-0 text-sm tabular-nums text-ink-muted sm:block">
                        {/* Vår egen lista, inte printedTotal — se kommentaren på setsidan. */}
                        {t("cards", { count: set._count.cards })}
                      </p>
                      <p className="shrink-0 text-sm tabular-nums text-ink-muted">
                        {t("products", { count: set._count.products })}
                      </p>
                      <IconChevronRight
                        size={18}
                        className="shrink-0 text-ink-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-holo-cyan"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
