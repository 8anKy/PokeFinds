/**
 * KONVERTERINGSTRATTEN (2026-09-15): såg paywallen → klickade Uppgradera → betalade.
 *
 * Ägarens fråga var "varför konverterar bara en av många?" och utan de här tre
 * talen går det inte att skilja "ingen ser paywallen" från "alla ser den och
 * backar". Källorna är prompternas `source` ("free-restock-limit",
 * "free-watch-intro", "chart-max", "priser"…), som `openPaywallOrNavigate`
 * stämplar och UpgradeButton läser tillbaka vid klicket.
 *
 * ⛔ Opersonligt: AnalyticsEvent bär ingen userId, så "betalade" kommer från en
 *    annan tabell (User.proSince i fönstret) och kan inte knytas till en källa.
 *    Talen ställs bredvid varandra, aldrig som en per-användare-kedja.
 * ⛔ Två frågor, båda i admin (force-dynamic) — aldrig på en publik sida.
 */
import { prisma } from "@/lib/db";

const DAY_MS = 86_400_000;

export interface PaywallFunnelRow {
  source: string;
  opens: number;
  upgradeClicks: number;
}

export interface PaywallFunnel {
  days: number;
  rows: PaywallFunnelRow[];
  totalOpens: number;
  totalUpgradeClicks: number;
  /** Konton vars första BETALDA Pro (proSince) föll i fönstret. */
  newPaying: number;
}

export function foldPaywallFunnel(
  grouped: Array<{ entityId: string | null; eventType: string; count: number }>
): PaywallFunnelRow[] {
  const bySource = new Map<string, PaywallFunnelRow>();
  for (const g of grouped) {
    const source = g.entityId ?? "unknown";
    const row = bySource.get(source) ?? { source, opens: 0, upgradeClicks: 0 };
    if (g.eventType === "paywall_open") row.opens += g.count;
    else if (g.eventType === "upgrade_click") row.upgradeClicks += g.count;
    bySource.set(source, row);
  }
  return [...bySource.values()].sort((a, b) => b.opens - a.opens || b.upgradeClicks - a.upgradeClicks);
}

export async function getPaywallFunnel(days: number): Promise<PaywallFunnel> {
  const since = new Date(Date.now() - days * DAY_MS);
  const [grouped, newPaying] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ["entityId", "eventType"],
      where: { eventType: { in: ["paywall_open", "upgrade_click"] }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { proSince: { gte: since } } }),
  ]);
  const rows = foldPaywallFunnel(
    grouped.map((g) => ({ entityId: g.entityId, eventType: g.eventType, count: g._count._all }))
  );
  return {
    days,
    rows,
    totalOpens: rows.reduce((n, r) => n + r.opens, 0),
    totalUpgradeClicks: rows.reduce((n, r) => n + r.upgradeClicks, 0),
    newPaying,
  };
}
