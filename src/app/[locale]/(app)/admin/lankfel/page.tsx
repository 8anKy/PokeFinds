import { prisma } from "@/lib/db";
import { formatGtin } from "@/lib/gtin";
import { getGtinConflicts } from "@/services/gtin-conflicts";
import { LinkReportsClient, type OfferReportRow } from "./link-reports-client";

export const dynamic = "force-dynamic";

/**
 * Admin: kön av anmälda butikslänkar ("Fel länk?" på produktsidan) PLUS de felaktiga
 * länkar streckkoden avslöjar helt utan att någon anmält dem.
 *
 * Streckkoderna visas SIDA VID SIDA. Skiljer de sig åt behövs ingen bedömning alls —
 * butikens sida bär en annan tillverkarkod än produkten vi visar, alltså är länken fel.
 * Rättningen görs mot RÅDATA: radera offern via ID (aldrig lappa det visade priset).
 */
export default async function AdminLinkReportsPage() {
  const [reports, conflictRows] = await Promise.all([
    prisma.offerReport.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        reason: true,
        note: true,
        createdAt: true,
        reporter: { select: { name: true } },
        offer: {
          select: {
            id: true, url: true, price: true, gtin: true,
            retailer: { select: { name: true } },
            product: { select: { title: true, slug: true, gtin: true } },
          },
        },
      },
    }),
    // Maskinellt hittade felaktiga länkar — med smarta filter (distributör-EAN + delade
    // sortimentskoder räknas inte) och admin-kvittering. Se src/services/gtin-conflicts.ts.
    getGtinConflicts(),
  ]);

  const rows: OfferReportRow[] = reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    reporterName: r.reporter?.name ?? null,
    offerId: r.offer.id,
    offerUrl: r.offer.url,
    offerPrice: r.offer.price,
    retailer: r.offer.retailer.name,
    productTitle: r.offer.product.title,
    productSlug: r.offer.product.slug,
    offerGtin: formatGtin(r.offer.gtin),
    productGtin: formatGtin(r.offer.product.gtin),
    // Bevisad felmatch — butikens sida bär en ANNAN tillverkarkod än produkten.
    gtinMismatch: !!r.offer.gtin && !!r.offer.product.gtin && r.offer.gtin !== r.offer.product.gtin,
  }));

  return <LinkReportsClient reports={rows} conflicts={conflictRows} />;
}
