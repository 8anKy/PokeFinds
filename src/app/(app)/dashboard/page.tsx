import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice, formatPercent, formatRelative } from "@/lib/format";
import { computeCollectionValue } from "@/services/collection";
import { getRecentRestocks, getTopDrops } from "@/services/market";
import { listAlerts } from "@/services/alerts";
import { getFeed } from "@/services/community";
import { StatCard } from "@/components/features/stat-card";
import { PriceChart } from "@/components/features/price-chart";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { NotificationsBell } from "@/components/features/notifications-bell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconBell,
  IconGem,
  IconHeart,
  IconMail,
  IconMessage,
  IconSearch,
  IconTrendingUp,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Översikt",
};

const POST_CATEGORY_LABELS: Record<string, string> = {
  PULLS: "Pulls",
  TRADES: "Byten",
  QUESTIONS: "Frågor",
  MARKET: "Marknad",
  NEWS: "Nyheter",
  COLLECTIONS: "Samlingar",
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgon";
  if (hour < 18) return "Hej";
  return "God kväll";
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const userId = session.user.id;

  const [collection, watchlistCount, unreadNotifications, restocks, drops, alerts, feed, watchedCategories] =
    await Promise.all([
      computeCollectionValue(userId),
      prisma.watchlistItem.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      getRecentRestocks(5),
      getTopDrops(12),
      listAlerts(userId, { page: 1, pageSize: 5 }),
      getFeed({ page: 1, pageSize: 3 }),
      prisma.watchlistItem.findMany({
        where: { userId },
        select: { product: { select: { category: true } } },
      }),
    ]);

  // Förändring 7d uppskattas från samlingens värdekurva (senaste två punkterna).
  const series = collection.valueOverTime;
  const change7d =
    series.length >= 2 && series[series.length - 2].value > 0
      ? Math.round(
          ((series[series.length - 1].value - series[series.length - 2].value) /
            series[series.length - 2].value) *
            10000
        ) / 100
      : null;

  // Rekommenderade fynd: prisfall inom kategorier användaren redan bevakar, annars topplistan.
  const categories = new Set(watchedCategories.map((w) => w.product.category));
  const recommended = (
    categories.size > 0 ? drops.filter((d) => categories.has(d.product.category)) : drops
  ).slice(0, 4);
  const topDrops = drops.slice(0, 4);

  const chartData = series.map((p) => ({ date: `${p.month}-01`, price: p.value }));

  return (
    <div className="space-y-8">
      {/* Hälsning + snabbsökning + notisklocka */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            {greeting()}, {session.user.name}!
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Här är läget på din samling och marknaden just nu.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form action="/produkter" method="GET" className="flex w-full max-w-xs gap-2" role="search">
            <Input
              type="search"
              name="q"
              placeholder="Sök produkt eller kort…"
              aria-label="Sök produkter"
            />
            <Button type="submit" variant="secondary" aria-label="Sök">
              <IconSearch size={18} />
            </Button>
          </form>
          <NotificationsBell />
        </div>
      </div>

      {/* Nyckeltal */}
      <div className="stagger-list grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Samlingsvärde"
          value={formatPrice(collection.totalValue)}
          icon={<IconGem size={20} />}
        />
        <StatCard
          label="Förändring 7d"
          value={change7d != null ? formatPercent(change7d) : "–"}
          change={change7d ?? undefined}
          icon={<IconTrendingUp size={20} />}
        />
        <StatCard label="Aktiva bevakningar" value={watchlistCount} icon={<IconBell size={20} />} />
        <StatCard
          label="Olästa notiser"
          value={unreadNotifications}
          icon={<IconMail size={20} />}
        />
      </div>

      {/* Värdeutveckling */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Samlingens värdeutveckling</CardTitle>
            <Link href="/samling" className="text-sm font-medium text-holo-cyan hover:underline">
              Till samlingen →
            </Link>
          </CardHeader>
          <CardContent>
            <PriceChart data={chartData} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Senaste restocks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Senaste restocks</CardTitle>
            <Link href="/marknad" className="text-sm font-medium text-holo-cyan hover:underline">
              Visa alla →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {restocks.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                Inga restocks upptäckta ännu. Vi håller utkik åt dig.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {restocks.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/produkter/${r.product.slug}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{r.product.title}</p>
                        <p className="text-xs text-ink-muted">
                          {r.retailer.name} · {formatRelative(r.detectedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {r.price != null && (
                          <span data-price className="text-sm font-semibold text-ink">
                            {formatPrice(r.price)}
                          </span>
                        )}
                        <Badge variant="success">I lager</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Dina senaste alerts */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Dina senaste alerts</CardTitle>
            <Link href="/bevakningar" className="text-sm font-medium text-holo-cyan hover:underline">
              Bevakningar →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                Inga alerts ännu. Lägg till bevakningar så säger vi till vid prisfall och restocks.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {alerts.items.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        a.status === "READ" ? "bg-surface-border" : "bg-holo-cyan"
                      }`}
                      aria-label={a.status === "READ" ? "Läst" : "Oläst"}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm ${
                          a.status === "READ" ? "text-ink-muted" : "font-medium text-ink"
                        }`}
                      >
                        {a.message}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-faint">{formatRelative(a.triggeredAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Största prisfall */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Största prisfall (7 dagar)</CardTitle>
          <Link
            href="/produkter?sortera=prisfall"
            className="text-sm font-medium text-holo-cyan hover:underline"
          >
            Visa fler →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {topDrops.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              Inga större prisfall just nu — marknaden håller andan.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {topDrops.map((d) => (
                <li key={d.productId}>
                  <Link
                    href={`/produkter/${d.product.slug}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{d.product.title}</p>
                      <p className="text-xs text-ink-muted">
                        {CATEGORY_LABELS[d.product.category] ?? "Övrigt"}
                        {d.product.set ? ` · ${d.product.set.name}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span data-price className="text-sm font-semibold text-ink">
                        {formatPrice(d.lastPrice)}
                      </span>
                      <PriceChange percent={d.changePercent} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Rekommenderade fynd */}
        <Card>
          <CardHeader>
            <CardTitle>Rekommenderade fynd</CardTitle>
            <p className="text-sm text-ink-muted">
              Prisfall inom kategorierna du bevakar.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {recommended.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                Inga fynd att rekommendera just nu. Lägg till fler bevakningar så lär vi oss vad du
                samlar på.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {recommended.map((d) => (
                  <li key={d.productId}>
                    <Link
                      href={`/produkter/${d.product.slug}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{d.product.title}</p>
                        <p className="text-xs text-ink-muted">
                          {CATEGORY_LABELS[d.product.category] ?? "Övrigt"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span data-price className="text-sm font-semibold text-ink">
                          {formatPrice(d.lastPrice)}
                        </span>
                        <PriceChange percent={d.changePercent} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Senaste från communityt */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Senaste från communityt</CardTitle>
            <Link href="/community" className="text-sm font-medium text-holo-cyan hover:underline">
              Till communityt →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {feed.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                Inga inlägg ännu — bli först att dela en pull!
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {feed.items.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/community/${p.id}`}
                      className="block px-5 py-3 transition-colors hover:bg-surface-overlay/50"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="info">{POST_CATEGORY_LABELS[p.category] ?? p.category}</Badge>
                        <span className="text-xs text-ink-faint">
                          {p.user.name} · {formatRelative(p.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium text-ink">{p.title}</p>
                      <p className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <IconHeart size={13} aria-hidden="true" />
                          {p.likeCount}
                          <span className="sr-only">gillningar</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <IconMessage size={13} aria-hidden="true" />
                          {p.commentCount}
                          <span className="sr-only">kommentarer</span>
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
