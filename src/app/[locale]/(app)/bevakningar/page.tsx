import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/services/watchlist";
import { listSetWatches } from "@/services/set-watch";
import { listAlerts } from "@/services/alerts";
import { countMissedRestocks } from "@/services/missed-restocks";
import { ProTextLink } from "@/components/features/pro-cta";
import { alertCopyKey } from "@/lib/alert-copy";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { IconBell, IconChevronDown, IconPlus } from "@/components/ui/icons";
import { lowestBuyableByProduct } from "@/services/alerts";
import { prisma } from "@/lib/db";
import { utcDaysAgo } from "@/lib/utils";
import { WatchlistTable, type WatchlistRow } from "./watchlist-table";
import { SubpageHeader } from "@/components/layout/subpage-header";
import { CircleButton } from "@/components/ui/back-circle";
import { RestockPausedBanner } from "@/components/features/restock-paused-banner";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Watchlist");
  return { title: t("metaTitle") };
}

const ALERT_STATUS: Record<string, { labelKey: string; variant: BadgeVariant }> = {
  PENDING: { labelKey: "statusPending", variant: "warning" },
  SENT: { labelKey: "statusSent", variant: "info" },
  FAILED: { labelKey: "statusFailed", variant: "danger" },
  READ: { labelKey: "statusRead", variant: "default" },
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");
  const t = await getTranslations("Watchlist");
  const locale = await getLocale();
  // force-dynamic ovan → env läses per besök; ingen ISR-fördröjning här.
  const restockPaused = restockAlertsPaused();
  const pricePaused = priceAlertsPaused();

  const [items, alerts, setWatches] = await Promise.all([
    listWatchlist(session.user.id),
    listAlerts(session.user.id, { page: 1, pageSize: 15 }),
    listSetWatches(session.user.id),
  ]);
  // "Det du missade": gratiskontots påfyllningar senaste veckan — det ärligaste
  // Pro-argumentet (services/missed-restocks.ts). En fråga, bara för Free, bara
  // när larmen är igång (under pausen hade raden sålt något vi stängt av).
  const productIds = items.map((i) => i.product.id);
  // "Köp hos …" + prislarmets ledtext (2026-10-25): två frågor över hela listan,
  // aldrig en per kort. Köpbarheten är rubrikprisets (lowestBuyableByProduct).
  const [missed, buyable, lows] = await Promise.all([
    !session.user.isPro && !restockPaused && items.length > 0 ? countMissedRestocks(productIds) : Promise.resolve(0),
    lowestBuyableByProduct(productIds),
    productIds.length > 0
      ? prisma.priceSnapshot.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, date: { gte: utcDaysAgo(30) }, minPrice: { gt: 0 } },
          _min: { minPrice: true },
        })
      : Promise.resolve([] as { productId: string; _min: { minPrice: number | null } }[]),
  ]);
  const low30 = new Map(lows.map((l) => [l.productId, l._min.minPrice ?? null]));

  const rows: WatchlistRow[] = items.map((item) => ({
    id: item.id,
    targetPrice: item.targetPrice,
    restockAlert: item.restockAlert,
    priceAlert: item.priceAlert,
    isPaused: item.isPaused,
    createdAt: item.createdAt.toISOString(),
    product: {
      id: item.product.id,
      title: item.product.title,
      slug: item.product.slug,
      // Bild + kategori kommer GRATIS med i listWatchlist-frågan (den include:ar
      // hela produkten) — de plockades bara aldrig ut hit. Ingen extra rundtur
      // per rad; lägg ALDRIG en egen bilduppslagning i den här mappningen.
      imageUrl: item.product.imageUrl,
      category: item.product.category,
      lowestPrice: item.product.lowestPrice,
      setName: item.product.set?.name ?? null,
      inStockCount: item.product.inStockCount,
    },
    buy: (() => {
      const b = buyable.get(item.product.id);
      return b ? { offerId: b.id, retailerName: b.retailer.name, price: b.price, url: b.url } : null;
    })(),
    low30: low30.get(item.product.id) ?? null,
  }));

  return (
    <div className="space-y-8">
      <div>
        {/* ⛔ Underrubriken lovade "vi larmar dig vid prisfall och målpriser".
            Sant fram till 2026-08-26, en lögn efter — och den står rakt ovanför
            listan med målpriser. Originaltexten är kvar under sin egen nyckel. */}
        <SubpageHeader
          title={t("h1")}
          subtitle={t(alertCopyKey("subtitle", pricePaused))}
          action={
            <CircleButton label={t("findProducts")} href="/produkter">
              <IconPlus size={20} />
            </CircleButton>
          }
          desktopAction={
            <LinkButton href="/produkter" variant="outline">
              <IconPlus size={16} />
              {t("findProducts")}
            </LinkButton>
          }
        />
      </div>

      {/* ⛔ Banner FÖRE bevakningarna, inte efter: set-bevakning och restock-
          reglaget nedan är helt beroende av de pausade larmen. Ser användaren
          listan först läser den som fungerande. */}
      {/* Banderollen avgör SJÄLV vilket besked som gäller (restock, prislarm eller båda)
          och renderar ingenting när ingendera är pausad — se restock-paused-banner.tsx. */}
      <RestockPausedBanner />

      {rows.length === 0 && setWatches.length === 0 ? (
        // Tomläget gäller bara när INGENTING bevakas.
        <EmptyState
          icon={<IconBell size={32} />}
          title={t("emptyTitle")}
          description={t("emptyDesc")}
          action={<LinkButton href="/produkter">{t("exploreProducts")}</LinkButton>}
        />
      ) : (
        <div>
          {missed > 0 && (
            <div className="mb-4 rounded-lg border border-holo-cyan/40 bg-holo-cyan/10 px-4 py-3 text-sm text-ink">
              {t.rich("missedRestocks", {
                count: missed,
                link: (c) => (
                  <ProTextLink source="missed-restocks" className="font-semibold text-holo-cyan hover:underline">
                    {c}
                  </ProTextLink>
                ),
              })}
            </div>
          )}
          <WatchlistTable
            initialItems={rows}
            initialSets={setWatches.map((s) => ({
              setId: s.setId,
              name: s.name,
              series: s.series,
              logoUrl: s.logoUrl,
              sealedCount: s.sealedCount,
              inStockCount: s.inStockCount,
              isPaused: s.isPaused,
            }))}
            isPro={session.user.isPro}
            restockPaused={restockPaused}
          />
        </div>
      )}

      {/* Larmhistoriken — hopfälld längst ned (designpasset 2026-10-25: sidan är
          Produkter · Set, historiken är en uppslagning, inte en egen flik). */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
          {t("alertHistory")}
          <IconChevronDown size={16} className="transition-transform group-open:rotate-180" />
        </summary>
      <Card className="mt-2">
        <CardContent className="p-0">
          {alerts.items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              {t("noAlerts")}
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {alerts.items.map((a) => {
                const status = ALERT_STATUS[a.status] ?? ALERT_STATUS.PENDING;
                return (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{a.message}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {t("triggered", { when: formatRelative(a.triggeredAt, locale) })}
                        {a.sentAt ? t("sentSuffix", { when: formatDateTime(a.sentAt, locale) }) : ""}
                      </p>
                    </div>
                    <Badge variant={status.variant} className="shrink-0">
                      {t(status.labelKey)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      </details>
    </div>
  );
}
