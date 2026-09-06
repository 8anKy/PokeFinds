/**
 * Appens sida av LARM-HITS: Discord-lanen har redan dömt att en butiks-URL fyllts på
 * (samma vakter som Discord-inläggen, DB-fritt); här knyts URL:en till vår produkt,
 * lagerhistoriken skrivs och larmen skapas. Läs filhuvudet i `src/lib/restock-hits.ts`.
 *
 * ⛔ SAMMA SKRIVNINGAR SOM NATTKEDJANS OFFER-DIFF (`runner.ts`), I SAMMA ORDNING:
 *    RestockEvent → checkRestockAlerts → flippa Offer.stockStatus SIST. Statusflippen
 *    konsumerar övergången; dör vi före larmet ser nästa hit (eller natten) den igen
 *    och cooldownen i checkRestockAlerts äter dubbletten. Dubbelt larm >> missat.
 * ⛔ LANENS "FRÅN" VINNER ÖVER DATABASENS. Offer.stockStatus skrivs av nattkedjan och
 *    av tidigare hits — en vara som sålde slut kl 10 och fylldes på kl 14 står som
 *    IN_STOCK i DB:n hela dagen. Lanen såg båda övergångarna med minutupplösning.
 * ⛔ GÖMDA PRODUKTER (hiddenAt / gömd kategori) uppdaterar lager men larmar aldrig —
 *    exakt som `isHiddenFromAlerts` i runner.ts. Discord-inlägget gick ändå ut, det
 *    är avsiktligt (se kommentaren där).
 * ✅ PRISSÄNKNINGS-HITS (kind PRICE_DROP, 2026-09-06): offerns pris skrivs och
 *    `checkPriceAlerts` döms på produktens lägsta KÖPBARA pris inklusive det nya —
 *    en billigare butik någon annanstans ⇒ inget larm. Egen grind (PRICE_ALERTS_PAUSED)
 *    i rutten; hit-kroppen är densamma.
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isDirectOfferUrl } from "@/lib/marketplace-urls";
import { checkPriceAlerts, checkRestockAlerts, lowestBuyableOffer, type BuyableOffer } from "@/services/alerts";
import { HIDDEN_CATEGORIES } from "@/services/products";
import { hitKind, type RestockHit, type RestockHitApplyResult } from "@/lib/restock-hits";

const STATUSES = new Set<string>(Object.values(StockStatus));

/** "ABSENT"/okänt → null; en riktig StockStatus passerar oförändrad. */
export function laneStatus(s: string | null | undefined): StockStatus | null {
  return s && STATUSES.has(s) ? (s as StockStatus) : null;
}

export async function applyRestockHits(hits: readonly RestockHit[]): Promise<RestockHitApplyResult> {
  const result: RestockHitApplyResult = {
    received: hits.length,
    matched: 0,
    events: 0,
    alerts: 0,
    skipped: {},
  };
  const skip = (why: string, n = 1) => {
    result.skipped[why] = (result.skipped[why] ?? 0) + n;
  };
  const now = new Date();

  for (const hit of hits) {
    const retailer = await prisma.retailer.findUnique({
      where: { name: hit.storeName },
      select: { id: true },
    });
    if (!retailer) {
      skip("okänd butik");
      continue;
    }
    const offer = await prisma.offer.findFirst({
      where: { url: hit.storeUrl, retailerId: retailer.id },
      select: {
        id: true,
        productId: true,
        url: true,
        price: true,
        stockStatus: true,
        product: { select: { category: true, hiddenAt: true, lowestPriceOre: true } },
      },
    });

    if (hitKind(hit) === "PRICE_DROP") {
      // PRISSÄNKNING: varan står i lager, priset är nyheten. Kräver en befintlig offer
      // (priset ska landa på en rad vi visar) och ett riktigt pris (> 0).
      if (!offer) {
        skip("okänd offer");
        continue;
      }
      if (hit.priceOre == null || hit.priceOre <= 0) {
        skip("inget pris");
        continue;
      }
      result.matched++;
      const hidden = offer.product.hiddenAt != null || HIDDEN_CATEGORIES.includes(offer.product.category);
      if (!hidden) {
        // LARMA FÖRST, SKRIV SIST (samma ordning som lagerhits): domen tas på produktens
        // lägsta köpbara pris MED den här offern på sitt nya pris — inte på feedens tal
        // rakt av (en annan butik kan fortfarande vara billigare ⇒ inget att larma om).
        const current = await lowestBuyableOffer(offer.productId);
        const candidate: BuyableOffer | null = isDirectOfferUrl(offer.url)
          ? { id: offer.id, productId: offer.productId, price: hit.priceOre, url: offer.url, retailerId: retailer.id, retailer: { name: hit.storeName } }
          : null;
        const lowest =
          candidate && (!current || candidate.price < current.price) ? candidate : current;
        const r = await checkPriceAlerts(offer.productId, {
          previousOre: offer.product.lowestPriceOre,
          lowest,
        });
        result.alerts += r.triggered;
        for (const [k, v] of Object.entries(r.skipped)) skip(`pris:${k}`, v);
      } else {
        skip("gömd produkt");
      }
      await prisma.offer.update({
        where: { id: offer.id },
        data: { price: hit.priceOre, stockStatus: StockStatus.IN_STOCK, lastSeenAt: now },
      });
      continue;
    }
    let productId: string;
    let product: { category: (typeof HIDDEN_CATEGORIES)[number]; hiddenAt: Date | null };
    if (offer) {
      productId = offer.productId;
      product = offer.product;
    } else {
      // Rutten kan komma ur en bunden StoreListing (feed-först) som ännu saknar Offer.
      const bySlug = await prisma.product.findUnique({
        where: { slug: hit.productSlug },
        select: { id: true, category: true, hiddenAt: true },
      });
      if (!bySlug) {
        skip("okänd produkt");
        continue;
      }
      productId = bySlug.id;
      product = bySlug;
    }
    result.matched++;

    const toStatus = hit.to as StockStatus;
    const laneFrom = laneStatus(hit.from);
    // oldStatus i händelsen: lanens egen "från" när den är en riktig status; annars
    // databasens — men aldrig samma som slutstatusen (en IN→IN-rad vore nonsens).
    const oldStatus =
      laneFrom ?? (offer && offer.stockStatus !== toStatus ? offer.stockStatus : StockStatus.UNKNOWN);
    const hidden = product.hiddenAt != null || HIDDEN_CATEGORIES.includes(product.category);

    if (hidden) {
      skip("gömd produkt");
    } else {
      await prisma.restockEvent.create({
        data: {
          productId,
          retailerId: retailer.id,
          oldStatus,
          newStatus: toStatus,
          price: hit.priceOre,
        },
      });
      result.events++;
      const r = await checkRestockAlerts(productId, retailer.id, { from: laneFrom, to: toStatus });
      result.alerts += r.triggered;
    }

    if (offer) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          stockStatus: toStatus,
          lastSeenAt: now,
          // Feedpriset är en AVLÄSNING vi ändå har; null = "vet inte" → rör inte.
          ...(hit.priceOre != null ? { price: hit.priceOre } : {}),
        },
      });
    }
  }
  return result;
}
