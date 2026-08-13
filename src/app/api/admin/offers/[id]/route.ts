import { prisma } from "@/lib/db";
import { apiError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { writeAuditLog } from "@/services/analytics";
import { recomputeProductPriceCache } from "@/services/products";
import { purgeMismatchedMarketplaceOffer } from "@/services/marketplace-offers";
import { normalizeListingUrl } from "@/scrapers/import-denylist";
import { isStoreRetailer } from "@/lib/offer-source";

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

    // ⛔ ATT RADERA RADEN RÄCKER INTE FÖR EN BUTIKS-OFFER. URL:en ligger kvar i
    //    butikens feed, och nästa skrapning (var 10:e minut) matchar den och skapar
    //    om offern — mätt 2026-08-13: ägaren tog bort två länkar på Base Set Booster
    //    och båda fanns igen inom en minut. "Ta bort" måste betyda borta.
    //    Marknadsplats-annonser går INTE hit: `purgeMismatchedMarketplaceOffer` har
    //    redan skrivit en dom på annons-id:t, vilket är deras motsvarighet.
    // ⛔ URL:en normaliseras med SAMMA funktion som läsningen — en rå URL matchar aldrig.
    const isStore = !purge && offer.url && isStoreRetailer(offer.retailer?.name ?? "");
    if (isStore) {
      const url = normalizeListingUrl(offer.url!);
      await prisma.deniedListingUrl.upsert({
        where: { url },
        update: {},
        create: {
          url,
          reason: `admin-borttagning av ${admin.email ?? admin.id}`,
          productId: offer.productId,
          retailer: offer.retailer?.name ?? null,
          createdById: admin.id,
        },
      });
    }
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
