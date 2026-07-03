import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listCollection, computeCollectionValue } from "@/services/collection";
import { listSales } from "@/services/sales";
import { syncSoldCollectionItems } from "@/jobs/tradera-sold-sync";
import { formatPrice, formatPercent } from "@/lib/format";
import { StatCard } from "@/components/features/stat-card";
import { CollectionValueChart } from "./collection-value-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconGem,
  IconPackage,
  IconReceipt,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";
import { CollectionClient, type CollectionRow } from "./collection-client";
import { MobileCollectionGrid } from "./mobile-collection-grid";
import { PortfolioTabs } from "./portfolio-tabs";
import { SoldList } from "./sold-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Min samling",
};

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const userId = session.user.id;

  // Ta bort sålda Tradera-annonser innan samlingen listas (känns "direkt" för
  // säljaren). No-op + inget Tradera-anrop när användaren inte har utlagda objekt.
  await syncSoldCollectionItems(userId).catch((e) =>
    console.error("[samling] sålt-synk misslyckades:", e)
  );

  const isPremium = session.user.planTier === "PREMIUM";
  const [items, value, user, sales] = await Promise.all([
    listCollection(userId),
    // Gratis: max 6 mån historik. Premium: full (range-väljaren styr visningen).
    computeCollectionValue(userId, { maxDays: isPremium ? null : 183 }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { isPublicCollection: true },
    }),
    listSales(userId),
  ]);

  // Slug per singel-kort → produktsida att inspektera (kortets billigaste produkt).
  const slugByCard = new Map<string, string>();
  const cardIds = items.map((i) => i.cardId).filter((v): v is string => v != null);
  if (cardIds.length > 0) {
    const cardProducts = await prisma.product.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true, slug: true, lowestPriceOre: true },
    });
    const bestPrice = new Map<string, number>();
    for (const p of cardProducts) {
      if (!p.cardId) continue;
      const lp = p.lowestPriceOre ?? Number.MAX_SAFE_INTEGER;
      const prev = bestPrice.get(p.cardId);
      if (prev == null || lp < prev) {
        bestPrice.set(p.cardId, lp);
        slugByCard.set(p.cardId, p.slug);
      }
    }
  }

  const rows: CollectionRow[] = items.map((item) => ({
    id: item.id,
    name: item.card?.name ?? item.product?.title ?? item.notes ?? "Okänt objekt",
    slug: item.product?.slug ?? (item.cardId ? slugByCard.get(item.cardId) ?? null : null),
    imageUrl: item.imageUrl ?? item.card?.imageUrl ?? item.product?.imageUrl ?? null,
    setName: item.card?.set?.name ?? null,
    quantity: item.quantity,
    condition: item.condition,
    language: item.language,
    purchasePrice: item.purchasePrice,
    purchaseDate: item.purchaseDate ? item.purchaseDate.toISOString() : null,
    // Live Cardmarket-trend (faller tillbaka på lagrad ögonblicksbild).
    estimatedValue: value.itemValues[item.id] ?? item.estimatedValue,
    gradingCompany: item.gradingCompany,
    grade: item.grade,
    notes: item.notes,
  }));

  const chartData = value.valueOverTime.map((p) => ({
    date: p.date,
    price: p.value,
  }));

  const topMovers = value.movers.slice(0, 2);
  // movers bär ingen slug — men dess id = samlings-objektets id, samma som rows
  // (som redan löst produkt-sluggen) → slå upp där så korten blir klickbara.
  const slugByItem = new Map(rows.map((r) => [r.id, r.slug]));

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold text-ink">Min samling</h1>

      <PortfolioTabs
        soldCount={sales.length}
        sold={<SoldList sales={sales} />}
        collection={
          <div className="space-y-8">
      {/* Mobil-hero: totalt värde + förändring över vald period + graf */}
      <section className="lg:hidden">
        <CollectionValueChart
          data={chartData}
          isPremium={isPremium}
          bleed
          totalValue={value.totalValue}
          itemCount={value.itemCount}
        />
      </section>

      {/* Nyckeltal — desktop */}
      <div className="hidden grid-cols-1 gap-4 sm:grid-cols-2 lg:grid xl:grid-cols-4">
        <StatCard
          label="Totalt värde"
          value={formatPrice(value.totalValue)}
          icon={<IconGem size={20} />}
        />
        <StatCard
          label="Total kostnad"
          value={formatPrice(value.totalCost)}
          icon={<IconReceipt size={20} />}
        />
        <StatCard
          label="Vinst / förlust"
          value={formatPrice(value.profit)}
          change={value.profitPercent ?? undefined}
          icon={value.profit >= 0 ? <IconTrendingUp size={20} /> : <IconTrendingDown size={20} />}
        />
        <StatCard label="Antal objekt" value={`${value.itemCount}`} icon={<IconPackage size={20} />} />
      </div>

      <div className="hidden gap-6 lg:grid lg:grid-cols-3">
        {/* Värdeutveckling */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Värdeutveckling</CardTitle>
          </CardHeader>
          <CardContent>
            <CollectionValueChart data={chartData} isPremium={isPremium} />
          </CardContent>
        </Card>

        {/* Mest värdefulla — lista (desktop) */}
        <Card className="hidden lg:block">
          <CardHeader>
            <CardTitle>Mest värdefulla</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {value.topItems.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                Lägg till uppskattade värden på dina objekt så toppar vi listan här.
              </p>
            ) : (
              <ol className="divide-y divide-surface-border">
                {value.topItems.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-holo-cyan/10 text-xs font-bold text-holo-cyan">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                      <p className="text-xs text-ink-muted">
                        {item.quantity} st · {formatPrice(item.estimatedValue)} / st
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {formatPrice(item.totalValue)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top movers — störst prisökning senaste 7 dagarna (mobil) */}
      {topMovers.length > 0 && (
        <section className="lg:hidden">
          <h2 className="mb-3 font-display text-xl font-bold text-ink">Top movers</h2>
          <div className="grid grid-cols-2 gap-3">
            {topMovers.map((m) => {
              const slug = slugByItem.get(m.id);
              const content = (
                <>
                  <div className="h-28 w-full overflow-hidden rounded-lg bg-surface-overlay">
                    {m.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-faint">
                        <IconPackage size={26} />
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs font-medium text-ink-muted">{m.name}</p>
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-ink">
                      {m.value != null ? formatPrice(m.value) : "–"}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-rise">
                      {formatPercent(m.percent)}
                    </span>
                  </div>
                </>
              );
              const cls = "card-surface flex flex-col gap-2 p-3";
              return slug ? (
                <Link key={m.id} href={`/produkter/${slug}`} className={cls}>
                  {content}
                </Link>
              ) : (
                <div key={m.id} className={cls}>
                  {content}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Samlingen som rutnät (mobil) — tryck = inspektera, håll inne = väljläge */}
      {rows.length > 0 && <MobileCollectionGrid rows={rows} />}

      {/* Tabell + verktyg (klient) — desktop */}
      <div className="hidden lg:block">
        <CollectionClient
          initialItems={rows}
          isPublicCollection={user?.isPublicCollection ?? false}
        />
      </div>
          </div>
        }
      />
    </div>
  );
}
