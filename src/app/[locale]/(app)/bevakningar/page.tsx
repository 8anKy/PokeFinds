import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/services/watchlist";
import { listAlerts } from "@/services/alerts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { IconBell, IconPlus } from "@/components/ui/icons";
import { WatchlistTable, type WatchlistRow } from "./watchlist-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bevakningar",
};

const ALERT_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: "Väntar", variant: "warning" },
  SENT: { label: "Skickad", variant: "info" },
  FAILED: { label: "Misslyckad", variant: "danger" },
  READ: { label: "Läst", variant: "default" },
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user) redirect("/logga-in");

  const [items, alerts] = await Promise.all([
    listWatchlist(session.user.id),
    listAlerts(session.user.id, { page: 1, pageSize: 15 }),
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
      lowestPrice: item.product.lowestPrice,
      setName: item.product.set?.name ?? null,
    },
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Bevakningar</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Vi larmar dig vid prisfall, målpriser och restocks — innan alla andra hinner före.
          </p>
        </div>
        <LinkButton href="/produkter" variant="outline">
          <IconPlus size={16} />
          Hitta produkter att bevaka
        </LinkButton>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconBell size={32} />}
          title="Du bevakar inget än"
          description="Lägg till produkter i din bevakningslista så säger vi till så fort priset faller eller lagret fylls på."
          action={<LinkButton href="/produkter">Utforska produkter</LinkButton>}
        />
      ) : (
        <WatchlistTable initialItems={rows} />
      )}

      {/* Alerthistorik */}
      <Card>
        <CardHeader>
          <CardTitle>Alerthistorik</CardTitle>
          <p className="text-sm text-ink-muted">Dina senast utlösta larm.</p>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">
              Inga larm har utlösts ännu. När något händer hittar du historiken här.
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
                        Utlöst {formatRelative(a.triggeredAt)}
                        {a.sentAt ? ` · Skickad ${formatDateTime(a.sentAt)}` : ""}
                      </p>
                    </div>
                    <Badge variant={status.variant} className="shrink-0">
                      {status.label}
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
