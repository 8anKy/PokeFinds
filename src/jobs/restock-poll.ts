/**
 * Frekvent restock-poll (var 30:e min via GitHub Actions). Kollar ENBART de
 * offers som (a) är slut i lager OCH (b) ligger på en produkt med en aktiv
 * restock-bevakning OCH (c) har en probe-bar URL (Shopify/Webhallen). Det är de
 * enda offers som faktiskt kan utlösa ett alert, så mängden är liten → körningen
 * tar sekunder och håller knappt Neon vaken (jfr den fulla 4h-skrapningen som
 * höll DB:n igång ~40 min). All HTTP sker mot enskilda produkt-endpoints.
 *
 * Vid OUT_OF_STOCK → IN_STOCK: uppdatera offern, skapa RestockEvent och kör
 * checkRestockAlerts. dispatchPendingAlerts mejlar i slutet (kräver
 * RESEND_API_KEY i miljön, se workflow).
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import { probeStock } from "../scrapers/stock-probe";
import { checkRestockAlerts } from "../services/alerts";
import { dispatchPendingAlerts } from "../services/notifications";

export interface RestockPollResult {
  candidates: number;
  checked: number;
  restocked: number;
  alertsSent: number;
}

export async function runRestockPoll(): Promise<RestockPollResult> {
  // Slutsålda offers på bevakade produkter (aktiv, ej pausad restock-bevakning).
  const offers = await prisma.offer.findMany({
    where: {
      stockStatus: StockStatus.OUT_OF_STOCK,
      product: { watchlistItems: { some: { restockAlert: true, isPaused: false } } },
    },
    select: { id: true, productId: true, retailerId: true, url: true, price: true },
  });

  let checked = 0;
  let restocked = 0;
  for (const o of offers) {
    const status = await probeStock(o.url); // null = kan inte probea (hoppar)
    if (status == null) continue;
    checked++;
    if (status !== StockStatus.IN_STOCK) continue;

    // Äkta OUT → IN: persistera + alert. Offern var OUT i queryn ovan, så detta
    // sker max en gång per restock (nästa körning ser den inte längre som slut).
    await prisma.offer.update({
      where: { id: o.id },
      data: { stockStatus: StockStatus.IN_STOCK, lastSeenAt: new Date() },
    });
    await prisma.restockEvent.create({
      data: {
        productId: o.productId,
        retailerId: o.retailerId,
        oldStatus: StockStatus.OUT_OF_STOCK,
        newStatus: StockStatus.IN_STOCK,
        price: o.price,
      },
    });
    await checkRestockAlerts(o.productId);
    restocked++;
  }

  const { sent } = await dispatchPendingAlerts();
  console.log(
    `[restock-poll] ${offers.length} kandidater, ${checked} probeade, ${restocked} restocks, ${sent} alerts.`
  );
  return { candidates: offers.length, checked, restocked, alertsSent: sent };
}
