/** Bevakningslista: lista, lägg till, uppdatera, ta bort. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import type { PlanTier } from "@prisma/client";

export const FREE_PLAN_WATCHLIST_LIMIT = 10;

const WATCHLIST_INCLUDE = {
  product: {
    include: {
      set: { select: { id: true, name: true } },
      offers: { select: { price: true, stockStatus: true } },
    },
  },
} as const;

function withLowestPrice<
  T extends { product: { offers: { price: number | null; stockStatus: string }[] } }
>(item: T) {
  const offers = item.product.offers.filter(
    (o): o is { price: number; stockStatus: string } => o.price !== null
  );
  const inStock = offers.filter((o) => o.stockStatus === "IN_STOCK");
  const pool = inStock.length > 0 ? inStock : offers;
  const lowestPrice =
    pool.length > 0 ? Math.min(...pool.map((o) => o.price)) : null;
  const { offers: _offers, ...product } = item.product;
  return { ...item, product: { ...product, lowestPrice } };
}

export async function listWatchlist(userId: string) {
  const items = await prisma.watchlistItem.findMany({
    where: { userId },
    include: WATCHLIST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return items.map(withLowestPrice);
}

export interface AddWatchlistInput {
  productId: string;
  targetPrice?: number;
  maxPrice?: number;
  restockAlert?: boolean;
  priceAlert?: boolean;
  channels?: string[];
}

export async function addWatchlistItem(
  userId: string,
  planTier: PlanTier,
  input: AddWatchlistInput
) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) throw new ServiceError(404, "Produkten hittades inte.");

  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_productId: { userId, productId: input.productId } },
  });
  if (existing) {
    throw new ServiceError(409, "Produkten finns redan i din bevakningslista.");
  }

  if (planTier === "FREE") {
    const count = await prisma.watchlistItem.count({ where: { userId } });
    if (count >= FREE_PLAN_WATCHLIST_LIMIT) {
      throw new ServiceError(
        403,
        "Du har nått maxgränsen för bevakningar på gratiskontot. Uppgradera till Premium för fler."
      );
    }
  }

  const item = await prisma.watchlistItem.create({
    data: {
      userId,
      productId: input.productId,
      targetPrice: input.targetPrice,
      maxPrice: input.maxPrice,
      restockAlert: input.restockAlert ?? true,
      priceAlert: input.priceAlert ?? true,
      ...(input.channels ? { channels: input.channels } : {}),
    },
    include: WATCHLIST_INCLUDE,
  });
  return withLowestPrice(item);
}

export interface UpdateWatchlistInput {
  targetPrice?: number | null;
  maxPrice?: number | null;
  restockAlert?: boolean;
  priceAlert?: boolean;
  isPaused?: boolean;
  channels?: string[];
}

export async function updateWatchlistItem(
  userId: string,
  itemId: string,
  input: UpdateWatchlistInput
) {
  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Bevakningen hittades inte.");
  }
  const updated = await prisma.watchlistItem.update({
    where: { id: itemId },
    data: {
      targetPrice: input.targetPrice,
      maxPrice: input.maxPrice,
      restockAlert: input.restockAlert,
      priceAlert: input.priceAlert,
      isPaused: input.isPaused,
      ...(input.channels ? { channels: input.channels } : {}),
    },
    include: WATCHLIST_INCLUDE,
  });
  return withLowestPrice(updated);
}

export async function removeWatchlistItem(userId: string, itemId: string) {
  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== userId) {
    throw new ServiceError(404, "Bevakningen hittades inte.");
  }
  await prisma.watchlistItem.delete({ where: { id: itemId } });
  return { deleted: true };
}
