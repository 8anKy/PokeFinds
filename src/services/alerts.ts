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
      // Prislarm är en Pro-förmån (jfr restock-larm).
      user: { planTier: "PREMIUM" },
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
          channel: "EMAIL",
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: watchers.length };
}

/**
 * Kontrollerar restock-larm för en produkt när påfyllning upptäckts.
 * Restock-larm är en Pro-förmån: mottagare = PRO-bevakare av produkten
 * (restockAlert) UNION Pro-användare som valt att få ALLA restocks
 * (notificationSettings.allRestocks=true). Gratisanvändare får inga restock-larm.
 * Skapar Alert (EMAIL) + Notification per unik användare.
 *
 * ponytail: ett mejl per restock per mottagare. Vid stora drop-vågor kan en
 * "alla restocks"-prenumerant få många mejl — lägg en daglig digest om det blir
 * ett problem (samla restocks under körningen och skicka en sammanfattning).
 */
export async function checkRestockAlerts(productId: string, retailerId?: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true },
  });
  if (!product) return { triggered: 0 };

  const [watchers, allSubs] = await Promise.all([
    prisma.watchlistItem.findMany({
      // Restock-larm är Pro-only — även bevakade produkter larmar bara för Pro.
      where: { productId, restockAlert: true, isPaused: false, user: { planTier: "PREMIUM" } },
      select: { userId: true },
    }),
    prisma.user.findMany({
      // "Alla restocks" är också en Pro-förmån.
      where: {
        notificationSettings: { path: ["allRestocks"], equals: true },
        planTier: "PREMIUM",
      },
      select: { id: true },
    }),
  ]);

  const userIds = new Set<string>();
  for (const w of watchers) userIds.add(w.userId);
  for (const u of allSubs) userIds.add(u.id);
  if (userIds.size === 0) return { triggered: 0 };

  const message = `${product.title} finns i lager igen!`;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const userId of userIds) {
    writes.push(
      // EMAIL-kanal → dispatchPendingAlerts skickar mejl (default IN_APP gjorde
      // att restocks aldrig mejlades). retailerId = butiken som fick lager igen →
      // mejlets "Köp nu" länkar direkt dit (buildAlertEmail).
      prisma.alert.create({
        data: {
          userId,
          productId,
          retailerId,
          type: "RESTOCK",
          message,
          channel: "EMAIL",
        },
      })
    );
  }
  await prisma.$transaction(writes);
  return { triggered: userIds.size };
}

/**
 * Feed-först-larm för en RÅ butiksannons (StoreListing) som INTE finns i katalogen
 * — antingen en helt ny produkt (NEW_LISTING) eller en restock av något vi inte har
 * som Offer (RESTOCK). Mottagare = Pro-användare med "Alla restocks/nya produkter"
 * påslaget (notificationSettings.allRestocks=true). Watchlist-bevakare kan inte gälla
 * (ingen katalog-produkt att bevaka). Mejlet byggs från annonsen (storeListingId).
 */
export async function checkListingAlerts(
  listing: { id: string; title: string; retailerId: string },
  kind: "NEW_LISTING" | "RESTOCK"
) {
  const subs = await prisma.user.findMany({
    where: {
      notificationSettings: { path: ["allRestocks"], equals: true },
      planTier: "PREMIUM",
    },
    select: { id: true },
  });
  if (subs.length === 0) return { triggered: 0 };

  const message =
    kind === "NEW_LISTING"
      ? `${listing.title} — ny produkt i lager!`
      : `${listing.title} finns i lager igen!`;
  const writes: Prisma.PrismaPromise<unknown>[] = subs.map((u) =>
    prisma.alert.create({
      data: {
        userId: u.id,
        retailerId: listing.retailerId,
        storeListingId: listing.id,
        type: kind,
        message,
        channel: "EMAIL",
      },
    })
  );
  await prisma.$transaction(writes);
  return { triggered: subs.length };
}
