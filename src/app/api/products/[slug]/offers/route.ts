import { apiError, jsonCached } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { NON_STORE_RETAILER_NAMES } from "@/services/products";
import { isSponsoredNow } from "@/lib/sponsored-offer";

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: params.slug },
      select: {
        id: true,
        updatedAt: true,
        offers: {
          include: {
            retailer: {
              select: {
                id: true,
                name: true,
                logoUrl: true,
                websiteUrl: true,
                affiliateEnabled: true,
                sponsoredUntil: true,
              },
            },
          },
          orderBy: { price: { sort: "asc", nulls: "last" } },
        },
      },
    });
    if (!product) throw new ServiceError(404, "Produkten hittades inte.");

    // Visa bara offers med direkt produktlänk — sök-/bläddringslänkar döljs och
    // räknas inte in i prisstatistiken (priset hör inte ihop med en köpbar sida).
    const directOffers = product.offers.filter(
      (o) =>
        isDirectOfferUrl(o.url) &&
        !NON_STORE_RETAILER_NAMES.includes(o.retailer?.name ?? "")
    );

    const priced = directOffers.filter(
      (o): o is (typeof directOffers)[number] & { price: number } => o.price !== null && o.price > 0
    );
    const prices = priced.map((o) => o.price);
    const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
    const pool = inStock.length > 0 ? inStock : priced;
    const best = pool.length > 0 ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;

    // ⛔ `sponsoredUntil` går ALDRIG ut som en Date i payloaden — klienten vill ha ett
    //    svar ("visas annonsarket?"), inte ett datum den måste tolka, och en Date som
    //    serialiseras till sträng är precis den fällan som bränt oss i unstable_cache.
    //    Domen tas här, en gång, mot samma klocka som produktdetaljen använder.
    const now = new Date();
    const serializedOffers = directOffers.map(({ retailer, ...o }) => ({
      ...o,
      retailer: {
        id: retailer.id,
        name: retailer.name,
        logoUrl: retailer.logoUrl,
        websiteUrl: retailer.websiteUrl,
        affiliateEnabled: retailer.affiliateEnabled,
        sponsored: isSponsoredNow(retailer.sponsoredUntil, now),
      },
    }));

    return jsonCached(
      {
        offers: serializedOffers,
        stats: {
          lowestPrice: best?.price ?? null,
          lowestPriceStockStatus: best?.stockStatus ?? null,
          highestPrice: prices.length > 0 ? Math.max(...prices) : null,
          avgPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
          offerCount: directOffers.length,
        },
        updatedAt: product.updatedAt,
      },
      60
    );
  } catch (e) {
    return apiError(e);
  }
}
