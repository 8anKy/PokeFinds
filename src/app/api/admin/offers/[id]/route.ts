import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { recomputeProductPriceCache } from "@/services/products";

export const dynamic = "force-dynamic";

/** Admin: ta bort en felmatchad/dålig offer direkt från produktsidan. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      select: { id: true, productId: true, url: true, price: true, retailer: { select: { name: true } } },
    });
    if (!offer) throw new ServiceError(404, "Erbjudandet hittades inte.");

    await prisma.offer.delete({ where: { id: params.id } });
    await recomputeProductPriceCache();

    await writeAuditLog({
      userId: admin.id,
      action: "offer.delete",
      entityType: "Offer",
      entityId: offer.id,
      metadata: { productId: offer.productId, url: offer.url, price: offer.price, retailer: offer.retailer?.name },
    });

    return jsonOk({ deleted: offer.id });
  } catch (e) {
    return apiError(e);
  }
}
