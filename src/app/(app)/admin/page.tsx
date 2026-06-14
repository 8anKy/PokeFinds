import { prisma } from "@/lib/db";
import { isRedisAvailable } from "@/lib/queue";
import { formatRelative, formatDateTime } from "@/lib/format";
import { getAdminStats } from "@/services/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: "Köad",
  RUNNING: "Pågår",
  COMPLETED: "Slutförd",
  FAILED: "Misslyckad",
  CANCELLED: "Avbruten",
};

const JOB_STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  QUEUED: "default",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "warning",
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold text-ink">{value}</p>
        {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function nf(value: number): string {
  return new Intl.NumberFormat("sv-SE").format(value);
}

export default async function AdminOverviewPage() {
  const [stats, observationCount, productsWithoutOffers, latestObservation, latestJob] =
    await Promise.all([
      getAdminStats(),
      prisma.priceObservation.count(),
      prisma.product.count({ where: { offers: { none: {} } } }),
      prisma.priceObservation.findFirst({
        orderBy: { observedAt: "desc" },
        select: { observedAt: true },
      }),
      prisma.scrapeJob.findFirst({
        orderBy: { createdAt: "desc" },
        include: { source: { select: { name: true } } },
      }),
    ]);

  const redisOk = isRedisAvailable();

  return (
    <div className="space-y-6">
      <section aria-label="Nyckeltal">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          <StatCard
            label="Användare"
            value={nf(stats.users.total)}
            hint={`${nf(stats.users.new7d)} nya senaste 7 dagarna · ${nf(stats.users.premium)} premium`}
          />
          <StatCard label="Produkter" value={nf(stats.catalog.products)} />
          <StatCard
            label="Erbjudanden"
            value={nf(stats.catalog.offers)}
            hint={`${nf(stats.catalog.retailers)} butiker`}
          />
          <StatCard label="Prisobservationer" value={nf(observationCount)} />
          <StatCard label="Aktiva bevakningar" value={nf(stats.engagement.watchlistItems)} />
          <StatCard
            label="Community-inlägg"
            value={nf(stats.engagement.posts)}
            hint={`${nf(stats.engagement.alerts24h)} aviseringar senaste dygnet`}
          />
          <StatCard
            label="Öppna rapporter"
            value={nf(stats.moderation.openReports)}
            hint="Väntar på moderering"
          />
          <StatCard
            label="Scrapejobb (24 h)"
            value={nf(stats.scraping.jobs24h)}
            hint={`${nf(stats.scraping.failed24h)} misslyckade`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Systemstatus</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Databas</span>
              <Badge variant="success">OK</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Redis</span>
              {redisOk ? (
                <Badge variant="success">Ansluten</Badge>
              ) : (
                <Badge variant="warning">Ej tillgänglig (fallback aktiv)</Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-muted">Senaste scrapejobb</span>
              {latestJob ? (
                <span className="flex items-center gap-2 text-sm text-ink">
                  <span className="text-ink-muted">{latestJob.source.name}</span>
                  <Badge variant={JOB_STATUS_VARIANTS[latestJob.status]}>
                    {JOB_STATUS_LABELS[latestJob.status]}
                  </Badge>
                  <span className="text-xs text-ink-faint">
                    {formatRelative(latestJob.createdAt)}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-ink-faint">Inga jobb ännu</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datakvalitet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Produkter utan erbjudanden</span>
              <span className="text-sm font-semibold text-ink">
                {nf(productsWithoutOffers)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Senaste prisobservation</span>
              <span className="text-sm text-ink">
                {latestObservation
                  ? `${formatRelative(latestObservation.observedAt)} (${formatDateTime(latestObservation.observedAt)})`
                  : "Inga observationer ännu"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
