import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Admin: kön av anmälda butikserbjudanden.
 *
 * Returnerar produktens och offerens streckkod SIDA VID SIDA — skiljer de sig åt är
 * länken bevisligen fel och behöver ingen bedömning alls. Fixen är att radera offern
 * via ID (DELETE /api/admin/offers/[id]), aldrig att lappa det visade priset.
 */
export async function GET() {
  try {
    await requireRole("ADMIN");

    const reports = await prisma.offerReport.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        reason: true,
        note: true,
        createdAt: true,
        reporter: { select: { name: true, email: true } },
        offer: {
          select: {
            id: true,
            url: true,
            price: true,
            gtin: true,
            stockStatus: true,
            retailer: { select: { name: true } },
            product: { select: { id: true, title: true, slug: true, gtin: true } },
          },
        },
      },
    });

    return jsonOk({
      reports: reports.map((r) => ({
        ...r,
        // Bevisad felmatch: butikens sida bär en ANNAN tillverkar-streckkod än produkten
        // vi visar. Ingen heuristik, ingen tröskel — bara två olika nummer.
        gtinMismatch:
          !!r.offer.gtin && !!r.offer.product.gtin && r.offer.gtin !== r.offer.product.gtin,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
