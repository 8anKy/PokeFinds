import { apiError, jsonCached } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const set = await prisma.cardSet.findUnique({
      where: { id: params.id },
      include: {
        // ⛔ `select` på `products`, inte `include` (2026-08-05): ett set kan ha
        // hundratals produkter och `include` skickade med HELA raden per produkt
        // (`description`-fritext, `normalizedTitle`, `gtin*`, räknare, tidsstämplar).
        // Fälten nedan speglar det setsidan faktiskt renderar — se
        // app/[locale]/(marketing)/sets/[id]/page.tsx, som är samma vy i HTML-form.
        products: {
          select: {
            id: true,
            slug: true,
            title: true,
            imageUrl: true,
            category: true,
            variantLabel: true,
            setId: true,
            cardId: true,
            offers: { select: { price: true, stockStatus: true } },
          },
          orderBy: { viewCount: "desc" },
        },
        _count: { select: { cards: true } },
      },
    });
    if (!set) throw new ServiceError(404, "Setet hittades inte.");

    const products = set.products.map((p) => {
      const priced = p.offers.filter((o) => o.price !== null);
      const inStock = priced.filter((o) => o.stockStatus === "IN_STOCK");
      const pool = inStock.length > 0 ? inStock : priced;
      const { offers: _offers, ...rest } = p;
      return {
        ...rest,
        lowestPrice:
          pool.length > 0 ? Math.min(...pool.map((o) => o.price as number)) : null,
      };
    });

    const { products: _products, _count, ...rest } = set;
    return jsonCached({ ...rest, cardCount: _count.cards, products }, 600);
  } catch (e) {
    return apiError(e);
  }
}
