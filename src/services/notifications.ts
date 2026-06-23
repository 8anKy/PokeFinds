/**
 * Notifikationer och utskick av väntande alerts.
 * Respekterar användarens notificationSettings
 * ({email, inApp, push, weeklyReport}).
 */
import { AlertChannel, AlertStatus, AlertType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { priceAlertEmail, restockAlertEmail } from "@/emails/templates";
import { NON_RETAIL_SOURCE_NAMES } from "@/services/products";

const MAX_RETRIES = 3;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";

export interface NotificationInput {
  title: string;
  body: string;
  linkUrl?: string;
}

interface NotificationSettings {
  email: boolean;
  inApp: boolean;
  push: boolean;
  weeklyReport: boolean;
}

function parseSettings(json: unknown): NotificationSettings {
  const defaults: NotificationSettings = {
    email: true,
    inApp: true,
    push: false,
    weeklyReport: true,
  };
  if (typeof json !== "object" || json === null) return defaults;
  const o = json as Record<string, unknown>;
  return {
    email: typeof o.email === "boolean" ? o.email : defaults.email,
    inApp: typeof o.inApp === "boolean" ? o.inApp : defaults.inApp,
    push: typeof o.push === "boolean" ? o.push : defaults.push,
    weeklyReport: typeof o.weeklyReport === "boolean" ? o.weeklyReport : defaults.weeklyReport,
  };
}

/** Skapar en in-app-notis. */
export async function createNotification(userId: string, input: NotificationInput) {
  return prisma.notification.create({
    data: {
      userId,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
    },
  });
}

/** Bygger e-postinnehåll för en alert baserat på typ. */
async function buildAlertEmail(alert: {
  type: AlertType;
  message: string;
  productId: string | null;
  user: { name: string };
}): Promise<{ subject: string; html: string; text: string }> {
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
        // Restock = butiks-händelse: visa billigaste butik som har den i lager,
        // aldrig Cardmarket/Tradera (de utlöser inte restock-larm).
        const retailOffer =
          product.offers.find(
            (o) =>
              o.stockStatus === "IN_STOCK" &&
              !NON_RETAIL_SOURCE_NAMES.includes(o.retailer.name)
          ) ?? bestOffer;
        return restockAlertEmail(
          alert.user.name,
          product.title,
          retailOffer?.retailer.name ?? "en återförsäljare",
          productUrl
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

/**
 * Skickar alla väntande alerts. EMAIL-kanal skickas via mailer,
 * IN_APP skapar en Notification. Markerar SENT/FAILED och räknar
 * omförsök (max 3).
 */
export async function dispatchPendingAlerts(): Promise<{ sent: number; failed: number }> {
  const pending = await prisma.alert.findMany({
    where: { status: AlertStatus.PENDING, retryCount: { lt: MAX_RETRIES } },
    include: { user: true, product: true },
    take: 200,
    orderBy: { triggeredAt: "asc" },
  });

  let sent = 0;
  let failed = 0;

  for (const alert of pending) {
    const settings = parseSettings(alert.user.notificationSettings);
    try {
      if (alert.channel === AlertChannel.EMAIL) {
        if (!settings.email) {
          // Användaren har stängt av e-post — markera som skickad utan utskick
          await prisma.alert.update({
            where: { id: alert.id },
            data: { status: AlertStatus.SENT, sentAt: new Date() },
          });
          continue;
        }
        const mail = await buildAlertEmail(alert);
        await sendMail({ to: alert.user.email, ...mail });
      } else if (alert.channel === AlertChannel.IN_APP) {
        if (settings.inApp) {
          await createNotification(alert.userId, {
            title: "Avisering",
            body: alert.message,
            linkUrl: alert.product ? `${APP_URL}/produkter/${alert.product.slug}` : undefined,
          });
        }
      } else if (alert.channel === AlertChannel.PUSH) {
        // Push stöds inte ännu — markera som skickad om avstängd, annars hoppa över tyst
        if (!settings.push) {
          await prisma.alert.update({
            where: { id: alert.id },
            data: { status: AlertStatus.SENT, sentAt: new Date() },
          });
          continue;
        }
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
