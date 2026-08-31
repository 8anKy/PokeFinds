import { prisma } from "@/lib/db";
import { HealthClient, type FindingRow } from "./health-client";

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
  const findings = await prisma.storeHealthFinding.findMany({
    orderBy: [{ section: "asc" }, { severity: "asc" }, { title: "asc" }],
  });

  const rows: FindingRow[] = findings.map((f) => ({
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

  return <HealthClient findings={rows} />;
}
