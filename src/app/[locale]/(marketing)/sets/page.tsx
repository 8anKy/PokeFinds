import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCards, IconChevronRight } from "@/components/ui/icons";

// Katalogdata ändras ~en gång/dygn → cacha (ISR). Sparar Vercel CPU + Neon-läsningar.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Set",
  description:
    "Bläddra bland alla Pokémon TCG-set — serier, releasedatum och produkter med aktuella priser.",
};

export default async function SetsPage() {
  const sets = await prisma.cardSet.findMany({
    include: { _count: { select: { cards: true, products: true } } },
    orderBy: { releaseDate: "desc" },
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
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Set</h1>
      <p className="mt-2 text-ink-muted">
        Alla set vi följer — med produkter, priser och prisindex.
      </p>

      {sets.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<IconCards size={32} />}
          title="Inga set ännu"
          description="Vi håller på att fylla på med set och produkter. Titta tillbaka snart."
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
                      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-overlay/60 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink group-hover:text-holo-cyan">
                          {set.name}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          Release {formatDate(set.releaseDate)}
                        </p>
                      </div>
                      <p className="hidden shrink-0 text-sm tabular-nums text-ink-muted sm:block">
                        {set.totalCards > 0 ? set.totalCards : set._count.cards} kort
                      </p>
                      <p className="shrink-0 text-sm tabular-nums text-ink-muted">
                        {set._count.products} produkter
                      </p>
                      <IconChevronRight
                        size={18}
                        className="shrink-0 text-ink-faint transition-colors group-hover:text-holo-cyan"
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
