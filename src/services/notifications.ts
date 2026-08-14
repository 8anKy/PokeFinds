/**
 * Notifikationer och utskick av väntande alerts.
 * Respekterar användarens notificationSettings ({email, push}).
 */
import { AlertStatus, AlertType, StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendMail, isPermanentMailError } from "@/lib/mailer";
import { sendPush } from "@/lib/apns";
import { newListingEmail, preorderEmail, priceAlertEmail, releasedEmail, restockAlertEmail } from "@/emails/templates";
import { NON_RETAIL_SOURCE_NAMES } from "@/services/products";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
// ⛔ Delad läsare (samma defaultvärden som förut: email=true, push=false).
// Fanns i tre handskrivna kopior — se src/lib/notification-settings.ts.
import { parseNotificationSettings as parseSettings } from "@/lib/notification-settings";

const MAX_RETRIES = 3;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.foilio.se";

/** Bygger e-postinnehåll för en alert baserat på typ. */
async function buildAlertEmail(alert: {
  type: AlertType;
  message: string;
  productId: string | null;
  retailerId: string | null;
  storeListingId: string | null;
  fromStatus: StockStatus | null;
  toStatus: StockStatus | null;
  /** Setnamn när larmet kom via en set-bevakning → mallen förklarar varför. */
  reasonSetName: string | null;
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
      const price = listing.price ?? undefined;
      if (listing.stockStatus === "PREORDER") {
        return preorderEmail(...args, price, alert.reasonSetName);
      }
      // Släpp: annonsen STOD på förhandsbokning när larmet skapades och är nu i lager.
      if (alert.fromStatus === StockStatus.PREORDER) {
        return releasedEmail(...args, price, alert.reasonSetName);
      }
      return alert.type === AlertType.NEW_LISTING
        ? newListingEmail(...args, price, alert.reasonSetName)
        : restockAlertEmail(...args, price, alert.reasonSetName);
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
        // "Se erbjudandet" ska öppna det faktiska erbjudandet (butik/Cardmarket/
        // Tradera) där priset matchar bevakningsmålet — INTE vår webbsida (dålig
        // upplevelse från mejl på mobil, öppnar mobil-webben, inte appen). offers är
        // sorterade billigast först → billigaste med en DIREKT länk vinner. Fall
        // tillbaka på vår produktsida bara om ingen direktlänk finns.
        const dealOffer = product.offers.find((o) => isDirectOfferUrl(o.url)) ?? bestOffer;
        const dealUrl =
          dealOffer && isDirectOfferUrl(dealOffer.url) ? dealOffer.url : productUrl;
        return priceAlertEmail(
          alert.user.name,
          product.title,
          dealOffer?.price ?? bestOffer?.price ?? 0,
          dealUrl
        );
      }
      if (alert.type === AlertType.RESTOCK) {
        // Restock = butiks-händelse. Länka DIREKT till butiken som fick lager igen
        // (alert.retailerId) — hämtad med EGEN fråga, inte ur prisfönstret ovan:
        // `product.offers` är de 10 BILLIGASTE prissatta offersen, och den
        // restockande butiken ligger ofta utanför det fönstret (mätt 2026-08-11:
        // 10 av 22 restock-mejl visade fel butik). Reserv = billigaste butik i
        // lager. Aldrig Cardmarket/Tradera (de utlöser inte restock-larm) — det
        // sista `bestOffer`-fallet var precis den läckan: CM är oftast billigast
        // och stod som avsändare i mejlet. Hellre vår produktsida än fel källa.
        const alertOffer = alert.retailerId
          ? await prisma.offer.findFirst({
              where: { productId: product.id, retailerId: alert.retailerId },
              include: { retailer: true },
            })
          : null;
        const retailOffer =
          alertOffer ??
          product.offers.find(
            (o) =>
              o.stockStatus === "IN_STOCK" &&
              !NON_RETAIL_SOURCE_NAMES.includes(o.retailer.name)
          ) ??
          null;
        // RESTOCK täcker tre olika besked — mallen väljs på lagerövergången, inte på
        // offerns status HÄR (den hann redan bli det nya läget under skanningen).
        // Saknas övergången (larm från före kolumnerna) → påfyllning, som förut.
        const args = [
          alert.user.name,
          product.title,
          retailOffer?.retailer.name ?? "en återförsäljare",
          retailOffer?.url ?? productUrl,
          retailOffer?.price ?? undefined,
        ] as const;
        if (alert.toStatus === StockStatus.PREORDER)
          return preorderEmail(...args, alert.reasonSetName);
        if (alert.fromStatus === StockStatus.PREORDER)
          return releasedEmail(...args, alert.reasonSetName);
        return restockAlertEmail(...args, alert.reasonSetName);
      }
      if (alert.type === AlertType.NEW_LISTING) {
        // Ny produkt i lager = butiks-händelse. Mejlet länkar DIREKT till butikens
        // egen produktsida (som RESTOCK ovan), inte vår Foilio-sida. Pushen länkar
        // fortfarande till vår produktsida (se sendAlertPush). PREORDER lagras som
        // NEW_LISTING → välj copy på offerns lagerstatus. Samma regel som RESTOCK:
        // larmets egen butiks-offer hämtas med egen fråga (prisfönstret ovan kan
        // sakna den), och reserven är en BUTIK i lager — aldrig `offers[0]`, som
        // oftast är Cardmarket.
        const listingOffer =
          (alert.retailerId
            ? await prisma.offer.findFirst({
                where: { productId: product.id, retailerId: alert.retailerId },
                include: { retailer: true },
              })
            : null) ??
          product.offers.find(
            (o) =>
              o.stockStatus === "IN_STOCK" &&
              !NON_RETAIL_SOURCE_NAMES.includes(o.retailer.name)
          ) ??
          null;
        const storeName = listingOffer?.retailer.name ?? "en butik";
        const args = [alert.user.name, product.title, storeName, listingOffer?.url ?? productUrl, listingOffer?.price ?? undefined] as const;
        return listingOffer?.stockStatus === StockStatus.PREORDER
          ? preorderEmail(...args, alert.reasonSetName)
          : newListingEmail(...args, alert.reasonSetName);
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
  fromStatus: StockStatus | null;
  toStatus: StockStatus | null;
  product: { slug: string } | null;
  storeListing: { url: string } | null;
}): Promise<void> {
  const tokens = await prisma.pushToken.findMany({
    where: { userId: alert.userId },
    select: { token: true },
  });
  if (tokens.length === 0) return;
  // Samma tre lager-besked som mejlet (buildAlertEmail) — pushen får inte säga
  // "Åter i lager" om mejlet säger "Nu släppt".
  const title =
    alert.type === AlertType.RESTOCK
      ? alert.toStatus === StockStatus.PREORDER
        ? "Öppen för förhandsbokning!"
        : alert.fromStatus === StockStatus.PREORDER
          ? "Nu släppt!"
          : "Åter i lager!"
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
      // ⛔ FÖRSÖK ALDRIG OM ETT PERMANENT FEL. Ogiltig mottagare, avvisad domän
      // eller trasig payload (4xx från Resend) blir inte rätt av tre försök —
      // varje försök är ännu en hård studs som skadar foilio.se:s avsändarrykte,
      // och ett bränt rykte tar med sig ALLA larmmejl, inte bara det här.
      // Övergående fel (5xx, timeout, nät) behåller trappan på tre försök.
      const permanent = isPermanentMailError(err);
      // Sätts till taket så att urvalsfrågan (retryCount < MAX_RETRIES) aldrig
      // plockar upp posten igen — statusen ensam är inte det som filtrerar.
      const newRetryCount = permanent ? MAX_RETRIES : alert.retryCount + 1;
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          retryCount: newRetryCount,
          // Behåll PENDING tills max antal omförsök nåtts
          status: newRetryCount >= MAX_RETRIES ? AlertStatus.FAILED : AlertStatus.PENDING,
        },
      });
      failed++;
      console.error(
        `[notifications] Kunde inte skicka alert ${alert.id}${permanent ? " (permanent fel — inga omförsök)" : ""}:`,
        err
      );
    }
  }

  return { sent, failed };
}
