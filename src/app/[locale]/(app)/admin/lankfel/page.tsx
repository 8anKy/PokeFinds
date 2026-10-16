import { prisma } from "@/lib/db";
import { formatGtin } from "@/lib/gtin";
import { getGtinConflicts } from "@/services/gtin-conflicts";
import { LinkReportsClient, type OfferReportRow, type ProductReportRow } from "./link-reports-client";

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
  const [reports, conflictRows, productReports] = await Promise.all([
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
    // "Något fel?" om själva produkten (pris, bild, kortinfo, dubblett) — 2026-10-16.
    prisma.productReport.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, kind: true, note: true, createdAt: true,
        reporter: { select: { name: true } },
        product: { select: { title: true, slug: true, lowestPriceOre: true } },
      },
    }),
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

  const productRows: ProductReportRow[] = productReports.map((r) => ({
    id: r.id,
    kind: r.kind,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    reporterName: r.reporter?.name ?? null,
    productTitle: r.product.title,
    productSlug: r.product.slug,
    productPrice: r.product.lowestPriceOre,
  }));

  return <LinkReportsClient reports={rows} conflicts={conflictRows} productReports={productRows} />;
}
