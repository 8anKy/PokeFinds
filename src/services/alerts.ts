/** Alerttjänster: skapande, listning, läsmarkering samt pris-/restock-kontroller. */
import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import type { AlertChannel, AlertType, Prisma } from "@prisma/client";

function formatSek(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
}

export interface CreateAlertInput {
  userId: string;
  productId?: string;
  type: AlertType;
  message: string;
  channel?: AlertChannel;
}

export async function createAlert(input: CreateAlertInput) {
  return prisma.alert.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      type: input.type,
      message: input.message,
      channel: input.channel ?? "IN_APP",
    },
  });
}

export async function listAlerts(
  userId: string,
  opts: { page?: number; pageSize?: number } = {}
) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const [items, total] = await prisma.$transaction([
    prisma.alert.findMany({
      where: { userId },
      include: {
        product: { select: { id: true, title: true, slug: true, imageUrl: true } },
      },
      orderBy: { triggeredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.alert.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function markRead(userId: string, alertId: string) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || alert.userId !== userId) {
    throw new ServiceError(404, "Aviseringen hittades inte.");
  }
  return prisma.alert.update({
    where: { id: alertId },
    data: { status: "READ" },
  });
}

/**
 * Kontrollerar prislarm för en produkt vid nytt pris (öre).
 * Skapar Alert + Notification för bevakningar med targetPrice >= newPrice.
 */
export async function checkPriceAlerts(productId: string, newPrice: number) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true },
  });
  if (!product) return { triggered: 0 };

  const watchers = await prisma.watchlistItem.findMany({
    where: {
      productId,
      priceAlert: true,
      isPaused: false,
      targetPrice: { not: null, gte: newPrice },
    },
    select: { userId: true, targetPrice: true },
  });
  if (watchers.length === 0) return { triggered: 0 };

  const message = `${product.title} har nått ditt målpris! Nuvarande pris: ${formatSek(newPrice)}.`;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const w of watchers) {
    writes.push(
      prisma.alert.create({
        data: {
          userId: w.userId,
          productId,
          type: "PRICE_TARGET",
          message,
        },
      }),
      prisma.notification.create({
        data: {
          userId: w.userId,
          title: "Prislarm utlöst",
          body: message,
          linkUrl: `/produkter/${product.slug}`,
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: watchers.length };
}

/**
 * Kontrollerar restock-larm för en produkt när påfyllning upptäckts.
 * Skapar Alert + Notification för bevakningar med restockAlert.
 */
export async function checkRestockAlerts(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true },
  });
  if (!product) return { triggered: 0 };

  const watchers = await prisma.watchlistItem.findMany({
    where: { productId, restockAlert: true, isPaused: false },
    select: { userId: true },
  });
  if (watchers.length === 0) return { triggered: 0 };

  const message = `${product.title} finns i lager igen!`;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const w of watchers) {
    writes.push(
      prisma.alert.create({
        data: {
          userId: w.userId,
          productId,
          type: "RESTOCK",
          message,
        },
      }),
      prisma.notification.create({
        data: {
          userId: w.userId,
          title: "Åter i lager",
          body: message,
          linkUrl: `/produkter/${product.slug}`,
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: watchers.length };
}
