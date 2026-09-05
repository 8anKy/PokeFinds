import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/services/watchlist";
import { listSetWatches } from "@/services/set-watch";
import { listAlerts } from "@/services/alerts";
import { alertCopyKey } from "@/lib/alert-copy";
import { priceAlertsPaused } from "@/lib/price-alerts-pause";
import { restockAlertsPaused } from "@/lib/restock-alerts-pause";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { IconBell, IconPlus } from "@/components/ui/icons";
import { WatchlistTable, type WatchlistRow } from "./watchlist-table";
import { WatchedSets } from "./watched-sets";
import { PageBackButton } from "@/components/layout/page-back-button";
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

  const rows: WatchlistRow[] = items.map((item) => ({
    id: item.id,
    targetPrice: item.targetPrice,
    restockAlert: item.restockAlert,
    priceAlert: item.priceAlert,
    isPaused: item.isPaused,
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
    },
  }));

  return (
    <div className="space-y-8">
      <div>
        <PageBackButton />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("h1")}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {/* ⛔ Underrubriken lovade "vi larmar dig vid prisfall och målpriser".
                Sant fram till 2026-08-26, en lögn efter — och den står rakt ovanför
                listan med målpriser. Originaltexten är kvar under sin egen nyckel. */}
            {t(alertCopyKey("subtitle", pricePaused))}
          </p>
        </div>
        <LinkButton href="/produkter" variant="outline">
          <IconPlus size={16} />
          {t("findProducts")}
        </LinkButton>
        </div>
      </div>

      {/* ⛔ Banner FÖRE bevakningarna, inte efter: set-bevakning och restock-
          reglaget nedan är helt beroende av de pausade larmen. Ser användaren
          listan först läser den som fungerande. */}
      {/* Banderollen avgör SJÄLV vilket besked som gäller (restock, prislarm eller båda)
          och renderar ingenting när ingendera är pausad — se restock-paused-banner.tsx. */}
      <RestockPausedBanner />

      {/* Set-bevakningar ovanför produktlistan: de täcker flest produkter och är
          det enda stället de går att se och ta bort. Kortet döljer sig självt när
          listan är tom. */}
      <WatchedSets
        initialSets={setWatches.map((s) => ({
          setId: s.setId,
          name: s.name,
          series: s.series,
          logoUrl: s.logoUrl,
          sealedCount: s.sealedCount,
        }))}
      />

      {rows.length === 0 ? (
        // Tomläget gäller bara när INGENTING bevakas — har man ett set bevakat är
        // listan inte tom, den är bara utan enskilda produkter.
        setWatches.length === 0 && (
          <EmptyState
            icon={<IconBell size={32} />}
            title={t("emptyTitle")}
            description={t("emptyDesc")}
            action={<LinkButton href="/produkter">{t("exploreProducts")}</LinkButton>}
          />
        )
      ) : (
        <WatchlistTable initialItems={rows} isPro={session.user.isPro} restockPaused={restockPaused} />
      )}

      {/* Alerthistorik */}
      <Card>
        <CardHeader>
          <CardTitle>{t("alertHistory")}</CardTitle>
          <p className="text-sm text-ink-muted">{t("alertHistorySub")}</p>
        </CardHeader>
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
    </div>
  );
}
