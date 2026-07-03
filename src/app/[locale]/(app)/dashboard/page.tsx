import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice, formatPercent, formatRelative } from "@/lib/format";
import { computeCollectionValue } from "@/services/collection";
import { getRecentRestocks, getTopDrops } from "@/services/market";
import { listAlerts } from "@/services/alerts";
import { getFeed } from "@/services/community";
import { StatCard } from "@/components/features/stat-card";
import { PriceChartLazy } from "@/components/features/price-chart-lazy";
import { CATEGORY_LABELS } from "@/components/features/product-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  IconBell,
  IconGem,
  IconHeart,
  IconMessage,
  IconSearch,
  IconTrendingUp,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Dashboard");
  return { title: t("metaTitle") };
}

function greetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "greetingNight";
  if (hour < 10) return "greetingMorning";
  if (hour < 18) return "greetingDay";
  return "greetingEvening";
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const userId = session.user.id;
  const t = await getTranslations("Dashboard");
  const tCat = await getTranslations("Category");
  const tPost = await getTranslations("PostCategory");

  const [collection, watchlistCount, restocks, drops, alerts, feed, watchedCategories] =
    await Promise.all([
      computeCollectionValue(userId),
      prisma.watchlistItem.count({ where: { userId } }),
      getRecentRestocks(5),
      getTopDrops(12),
      listAlerts(userId, { page: 1, pageSize: 5 }),
      getFeed({ page: 1, pageSize: 3 }),
      prisma.watchlistItem.findMany({
        where: { userId },
        select: { product: { select: { category: true } } },
      }),
    ]);

  // Förändring 7d uppskattas från samlingens värdekurva (daglig: nu vs ~7 dagar bak,
  // eller äldsta punkten om historiken är kortare än så).
  const series = collection.valueOverTime;
  const ref7d = series.length >= 2 ? series[Math.max(0, series.length - 8)] : null;
  const change7d =
    ref7d && ref7d.value > 0
      ? Math.round(
          ((series[series.length - 1].value - ref7d.value) / ref7d.value) * 10000
        ) / 100
      : null;

  // Rekommenderade fynd: prisfall inom kategorier användaren redan bevakar, annars topplistan.
  const categories = new Set(watchedCategories.map((w) => w.product.category));
  const recommended = (
    categories.size > 0 ? drops.filter((d) => categories.has(d.product.category)) : drops
  ).slice(0, 4);
  const topDrops = drops.slice(0, 4);

  const chartData = series.map((p) => ({ date: p.date, price: p.value }));

  return (
    <div className="space-y-8">
      {/* Hälsning + snabbsökning + notisklocka */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            {t(greetingKey())}, {session.user.name}!
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("intro")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form action="/produkter" method="GET" className="flex w-full max-w-xs gap-2" role="search">
            <Input
              type="search"
              name="q"
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria")}
            />
            <Button type="submit" variant="secondary" aria-label={t("searchBtn")}>
              <IconSearch size={18} />
            </Button>
          </form>
        </div>
      </div>

      {/* Nyckeltal */}
      <div className="stagger-list grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("statValue")}
          value={formatPrice(collection.totalValue)}
          icon={<IconGem size={20} />}
        />
        <StatCard
          label={t("statChange7d")}
          value={change7d != null ? formatPercent(change7d) : "–"}
          change={change7d ?? undefined}
          icon={<IconTrendingUp size={20} />}
        />
        <StatCard label={t("statWatches")} value={watchlistCount} icon={<IconBell size={20} />} />
      </div>

      {/* Värdeutveckling */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("valueTrend")}</CardTitle>
            <Link href="/samling" className="text-sm font-medium text-holo-cyan hover:underline">
              {t("toCollection")}
            </Link>
          </CardHeader>
          <CardContent>
            <PriceChartLazy data={chartData} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Senaste restocks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("recentRestocks")}</CardTitle>
            <Link href="/marknad" className="text-sm font-medium text-holo-cyan hover:underline">
              {t("showAll")}
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {restocks.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noRestocks")}
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
                        <Badge variant="success">{t("inStock")}</Badge>
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
            <CardTitle>{t("yourAlerts")}</CardTitle>
            <Link href="/bevakningar" className="text-sm font-medium text-holo-cyan hover:underline">
              {t("toWatches")}
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noAlerts")}
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {alerts.items.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        a.status === "READ" ? "bg-surface-border" : "bg-holo-cyan"
                      }`}
                      aria-label={a.status === "READ" ? t("read") : t("unread")}
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
          <CardTitle>{t("topDrops")}</CardTitle>
          <Link
            href="/produkter?sortera=prisfall"
            className="text-sm font-medium text-holo-cyan hover:underline"
          >
            {t("showMore")}
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {topDrops.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              {t("noDrops")}
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
                        {d.product.category in CATEGORY_LABELS ? tCat(d.product.category) : tCat("OTHER")}
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
            <CardTitle>{t("recommended")}</CardTitle>
            <p className="text-sm text-ink-muted">
              {t("recommendedSub")}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {recommended.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noRecommended")}
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
                          {d.product.category in CATEGORY_LABELS ? tCat(d.product.category) : tCat("OTHER")}
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
            <CardTitle>{t("community")}</CardTitle>
            <Link href="/community" className="text-sm font-medium text-holo-cyan hover:underline">
              {t("toCommunity")}
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {feed.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {t("noPosts")}
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
                        <Badge variant="info">{tPost.has(p.category) ? tPost(p.category) : p.category}</Badge>
                        <span className="text-xs text-ink-faint">
                          {p.user.name} · {formatRelative(p.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium text-ink">{p.title}</p>
                      <p className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <IconHeart size={13} aria-hidden="true" />
                          {p.likeCount}
                          <span className="sr-only">{t("likes")}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <IconMessage size={13} aria-hidden="true" />
                          {p.commentCount}
                          <span className="sr-only">{t("comments")}</span>
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
