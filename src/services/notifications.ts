/**
 * Notifikationer och utskick av väntande alerts.
 * Respekterar användarens notificationSettings ({email, push}).
 */
import { AlertStatus, AlertType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { sendPush } from "@/lib/apns";
import { newListingEmail, preorderEmail, priceAlertEmail, restockAlertEmail } from "@/emails/templates";
import { NON_RETAIL_SOURCE_NAMES } from "@/services/products";

const MAX_RETRIES = 3;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";

interface NotificationSettings {
  email: boolean;
  push: boolean;
}

function parseSettings(json: unknown): NotificationSettings {
  const defaults: NotificationSettings = { email: true, push: false };
  if (typeof json !== "object" || json === null) return defaults;
  const o = json as Record<string, unknown>;
  return {
    email: typeof o.email === "boolean" ? o.email : defaults.email,
    push: typeof o.push === "boolean" ? o.push : defaults.push,
  };
}

/** Bygger e-postinnehåll för en alert baserat på typ. */
async function buildAlertEmail(alert: {
  type: AlertType;
  message: string;
  productId: string | null;
  retailerId: string | null;
  storeListingId: string | null;
  user: { name: string };
}): Promise<{ subject: string; html: string; text: string }> {
  // Feed-först-larm (ny produkt/restock utanför katalogen) — bygg mejlet från den
  // råa annonsen och länka DIREKT till butiken (ingen Foilio-produktsida finns).
  if (alert.storeListingId) {
    const listing = await prisma.storeListing.findUnique({
      where: { id: alert.storeListingId },
      include: { retailer: { select: { name: true } } },
    });
    if (listing) {
      const args = [
        alert.user.name,
        listing.title,
        listing.retailer.name,
        listing.url,
      ] as const;
      // Förhandsbokning känns igen på annonsens lagerstatus, inte AlertType (den
      // lagras som NEW_LISTING). Köpbar nu, levereras vid release → egen copy.
      if (listing.stockStatus === "PREORDER") {
        return preorderEmail(...args, listing.price ?? undefined);
      }
      return alert.type === AlertType.NEW_LISTING
        ? newListingEmail(...args, listing.price ?? undefined)
        : restockAlertEmail(...args, listing.price ?? undefined);
    }
  }
  if (alert.productId) {
    const product = await prisma.product.findUnique({
      where: { id: alert.productId },
      include: {
        offers: {
          where: { price: { not: null } },
          orderBy: { price: "asc" },
          take: 10,
          include: { retailer: true },
        },
      },
    });
    if (product) {
      const productUrl = `${APP_URL}/produkter/${product.slug}`;
      const bestOffer = product.offers[0];
      if (alert.type === AlertType.PRICE_DROP || alert.type === AlertType.PRICE_TARGET) {
        return priceAlertEmail(
          alert.user.name,
          product.title,
          bestOffer?.price ?? 0,
          productUrl
        );
      }
      if (alert.type === AlertType.RESTOCK) {
        // Restock = butiks-händelse. Länka DIREKT till butiken som fick lager igen
        // (alert.retailerId), annars billigaste butik i lager. Aldrig Cardmarket/
        // Tradera (de utlöser inte restock-larm). "Köp nu" → butikens egen produktsida.
        const retailOffer =
          (alert.retailerId &&
            product.offers.find((o) => o.retailerId === alert.retailerId)) ||
          product.offers.find(
            (o) =>
              o.stockStatus === "IN_STOCK" &&
              !NON_RETAIL_SOURCE_NAMES.includes(o.retailer.name)
          ) ||
          bestOffer;
        return restockAlertEmail(
          alert.user.name,
          product.title,
          retailOffer?.retailer.name ?? "en återförsäljare",
          retailOffer?.url ?? productUrl,
          retailOffer?.price ?? undefined
        );
      }
    }
  }
  // Generiskt fallback-mejl
  return {
    subject: "Avisering från Foilio",
    html: `<p>Hej ${alert.user.name}!</p><p>${alert.message}</p>`,
    text: `Hej ${alert.user.name}!\n\n${alert.message}`,
  };
}

/** Skickar en alert som native push till användarens enheter (om någon finns). */
async function sendAlertPush(alert: {
  userId: string;
  type: AlertType;
  message: string;
  product: { slug: string } | null;
  storeListing: { url: string } | null;
}): Promise<void> {
  const tokens = await prisma.pushToken.findMany({
    where: { userId: alert.userId },
    select: { token: true },
  });
  if (tokens.length === 0) return;
  const title =
    alert.type === AlertType.RESTOCK
      ? "Åter i lager!"
      : alert.type === AlertType.NEW_LISTING
        ? "Ny produkt i lager!"
        : "Prislarm";
  // Katalogprodukt → in-app-sida; feed-först-larm (ingen produkt) → butikens annons-URL
  // (klienten öppnar http-länkar externt, som mejlets "Till produkten"-knapp).
  const url = alert.product
    ? `/produkter/${alert.product.slug}`
    : alert.storeListing?.url ?? undefined;
  const { invalidTokens } = await sendPush(
    tokens.map((t) => t.token),
    { title, body: alert.message, url }
  );
  if (invalidTokens.length > 0) {
    await prisma.pushToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }
}

/**
 * Skickar alla väntande alerts till användarens PÅSLAGNA kanaler (e-post och/eller
 * native push). Markerar SENT/FAILED och räknar omförsök (max 3).
 */
export async function dispatchPendingAlerts(): Promise<{ sent: number; failed: number }> {
  const pending = await prisma.alert.findMany({
    where: { status: AlertStatus.PENDING, retryCount: { lt: MAX_RETRIES } },
    include: { user: true, product: true, storeListing: { select: { url: true } } },
    take: 200,
    orderBy: { triggeredAt: "asc" },
  });

  let sent = 0;
  let failed = 0;

  for (const alert of pending) {
    const settings = parseSettings(alert.user.notificationSettings);
    try {
      if (settings.email) {
        const mail = await buildAlertEmail(alert);
        await sendMail({ to: alert.user.email, ...mail });
      }
      if (settings.push) {
        await sendAlertPush(alert);
      }

      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: AlertStatus.SENT, sentAt: new Date() },
      });
      sent++;
    } catch (err) {
      const newRetryCount = alert.retryCount + 1;
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          retryCount: newRetryCount,
          // Behåll PENDING tills max antal omförsök nåtts
          status: newRetryCount >= MAX_RETRIES ? AlertStatus.FAILED : AlertStatus.PENDING,
        },
      });
      failed++;
      console.error(`[notifications] Kunde inte skicka alert ${alert.id}:`, err);
    }
  }

  return { sent, failed };
}
