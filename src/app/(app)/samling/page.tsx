import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listCollection, computeCollectionValue } from "@/services/collection";
import { formatPrice, formatPercent } from "@/lib/format";
import { StatCard } from "@/components/features/stat-card";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconGem,
  IconPackage,
  IconReceipt,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";
import { CollectionClient, type CollectionRow } from "./collection-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Min samling",
};

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const userId = session.user.id;

  const [items, value, user] = await Promise.all([
    listCollection(userId),
    computeCollectionValue(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { isPublicCollection: true },
    }),
  ]);

  const rows: CollectionRow[] = items.map((item) => ({
    id: item.id,
    name: item.card?.name ?? item.product?.title ?? item.notes ?? "Okänt objekt",
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
    date: `${p.month}-01`,
    price: p.value,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Min samling</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Håll koll på vad din samling är värd — kort för kort, box för box.
        </p>
      </div>

      {/* Nyckeltal */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Värdeutveckling */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Värdeutveckling</CardTitle>
            <p className="text-sm text-ink-muted">
              Samlingens uppskattade värde över tid, baserat på inköpsdatum.
            </p>
          </CardHeader>
          <CardContent>
            <PriceChartLazy data={chartData} />
          </CardContent>
        </Card>

        {/* Mest värdefulla */}
        <Card>
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

      {value.profitPercent != null && (
        <p className="text-sm text-ink-muted">
          Total avkastning: <span className="font-medium text-ink">{formatPercent(value.profitPercent)}</span>{" "}
          jämfört med inköpskostnaden.
        </p>
      )}

      {/* Tabell + verktyg (klient) */}
      <CollectionClient
        initialItems={rows}
        isPublicCollection={user?.isPublicCollection ?? false}
      />
    </div>
  );
}
