import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { recomputeProductPriceCache } from "@/services/products";
import { purgeMismatchedMarketplaceOffer } from "@/services/marketplace-offers";

export const dynamic = "force-dynamic";

/**
 * Admin: ta bort en felmatchad/dålig offer direkt från produktsidan.
 *
 * ⛔ För en MARKNADSPLATS-annons räcker det inte att radera raden: annonsen ligger
 * kvar hos Tradera, matchar fortfarande, och nästa svep skriver tillbaka den
 * (dessutom stod produkten kvar med en karusell full av annonser men ingen rad i
 * pristabellen). Sådana offers går därför genom hela purge-receptet — samma kod
 * som `scripts/purge-mismatched-offer.ts` — som också lyfter fram nästa vettiga
 * annons. Butiks-offers har ingen annons-identitet och raderas rakt av som förut.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("ADMIN");

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      select: {
        id: true, productId: true, url: true, price: true, retailerId: true,
        retailer: { select: { name: true } },
        product: { select: { category: true } },
      },
    });
    if (!offer) throw new ServiceError(404, "Erbjudandet hittades inte.");

    const purge = await purgeMismatchedMarketplaceOffer(
      {
        id: offer.id,
        productId: offer.productId,
        price: offer.price,
        url: offer.url,
        retailerId: offer.retailerId,
        retailerName: offer.retailer?.name ?? "",
        productCategory: offer.product?.category ?? "OTHER",
      },
      `admin-borttagning av ${admin.email ?? admin.id}`
    );
    if (!purge) await prisma.offer.delete({ where: { id: params.id } });
    await recomputeProductPriceCache();

    await writeAuditLog({
      userId: admin.id,
      action: "offer.delete",
      entityType: "Offer",
      entityId: offer.id,
      metadata: {
        productId: offer.productId, url: offer.url, price: offer.price,
        retailer: offer.retailer?.name,
        ...(purge && {
          itemId: purge.itemId,
          poisonedObservations: purge.poisonedObservations,
          replacedWith: purge.replacement?.url ?? null,
        }),
      },
    });

    return jsonOk({
      deleted: offer.id,
      replacedWith: purge?.replacement?.price ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}
