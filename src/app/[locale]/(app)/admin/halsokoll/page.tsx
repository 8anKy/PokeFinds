import { prisma } from "@/lib/db";
import { healthAckKey } from "@/lib/store-health-findings";
import { HealthClient, type AckRow, type FindingRow } from "./health-client";

export const dynamic = "force-dynamic";

/**
 * Admin: butiks-hälsokollens backlog — samma fynd som veckans store-health-körning
 * skriver till Actions-loggen, speglade till StoreHealthFinding (skrivs av skripten
 * när STORE_HEALTH_DB=1, dvs bara i workflowen). Byggd 2026-08-31 efter att kollen
 * varit röd TRE måndagar i rad utan att backloggen syntes någonstans i admin.
 *
 * Tabellen är alltid SENASTE körningen (varje skript ersätter sin sektion) —
 * historiken bor i Actions-loggen, aldrig här.
 */
export default async function AdminHealthPage() {
  const [findings, acks] = await Promise.all([
    prisma.storeHealthFinding.findMany({
      orderBy: [{ section: "asc" }, { severity: "asc" }, { title: "asc" }],
    }),
    prisma.storeHealthAck.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  // Kvitterade fynd ("korrekt — rapporten har fel") döljs ur arbetslistan men listas
  // separat med ångra-knapp. Nyckeln är stabil över veckans omskrivningar.
  const ackKeys = new Set(acks.map((a) => a.key));
  const rows: FindingRow[] = findings
    .filter((f) => !ackKeys.has(healthAckKey(f.section, f)))
    .map((f) => ({
      id: f.id,
      section: f.section,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      url: f.url,
      offerId: f.offerId,
      productSlug: f.productSlug,
      retailer: f.retailer,
      reportedAt: f.reportedAt.toISOString(),
    }));
  const ackRows: AckRow[] = acks.map((a) => ({
    id: a.id,
    section: a.section,
    title: a.title,
    createdAt: a.createdAt.toISOString(),
  }));

  return <HealthClient findings={rows} acks={ackRows} />;
}
