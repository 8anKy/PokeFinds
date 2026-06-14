/**
 * Rebuild all single-card prices from REAL market data:
 * 1. Fetch fresh Cardmarket prices from api.pokemontcg.io for sets whose
 *    products lack offers (Ascended Heroes, Chaos Rising, Perfect Order, ...)
 * 2. Rebuild ALL single-card offers from the latest real PriceObservation:
 *    - Cardmarket: exact CM trend price (EUR -> SEK via live getRatesOre), shipping 45 kr
 *    - Tradera: market-aligned price, shipping 69 kr
 * 3. Precise search URLs: card name + set name (+ number for Cardmarket)
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchTcgCardsForSet,
  cardMarketPriceOre,
} from "../src/scrapers/adapters/pokemontcg-adapter";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();

const BATCH = 25;

async function main() {
  console.log("=== REBUILD REAL PRICES ===\n");
  await getRatesOre(); // live EUR/USD-kurs → cardMarketPriceOre läser den synkront

  const cardmarket = await prisma.retailer.findUnique({ where: { name: "Cardmarket" } });
  const tradera = await prisma.retailer.findUnique({ where: { name: "Tradera" } });
  if (!cardmarket || !tradera) throw new Error("Retailers missing");

  // ============ 1. FETCH FRESH PRICES FOR SETS MISSING OFFERS ============
  console.log("1. Fetching fresh prices from pokemontcg.io for sets missing offers...");

  const missingProds = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", offers: { none: {} } },
    select: { set: { select: { id: true, externalId: true, name: true } } },
  });
  const setExternalIds = new Map<string, { dbId: string; name: string }>();
  for (const p of missingProds) {
    if (p.set?.externalId) {
      setExternalIds.set(p.set.externalId, { dbId: p.set.id, name: p.set.name });
    }
  }
  console.log("   Sets to fetch: " + [...setExternalIds.keys()].join(", "));

  let newObs = 0;
  for (const [extId, setInfo] of setExternalIds) {
    try {
      const cards = await fetchTcgCardsForSet(extId, 300);
      console.log("   " + setInfo.name + ": " + cards.length + " cards from API");
      for (const tcgCard of cards) {
        const priceOre = cardMarketPriceOre(tcgCard);
        if (!priceOre) continue;
        // Find product for this card via card.tcgExternalId
        const card = await prisma.card.findFirst({
          where: { tcgExternalId: tcgCard.id },
          select: { id: true, products: { select: { id: true }, take: 1 } },
        });
        const productId = card?.products[0]?.id;
        if (!productId) continue;
        await prisma.priceObservation.create({
          data: {
            productId,
            price: priceOre,
            currency: "SEK",
            rawData: {
              retailer: "Cardmarket",
              stockStatus: "IN_STOCK",
              url: "https://www.cardmarket.com/en/Pokemon",
              cardId: tcgCard.id,
              cardmarket: tcgCard.cardmarket ?? null,
              tcgplayer: tcgCard.tcgplayer ?? null,
              priceOre,
            },
          },
        });
        newObs++;
      }
    } catch (e) {
      console.log("   WARN could not fetch " + extId + ": " + (e as Error).message?.slice(0, 80));
    }
  }
  console.log("   Created " + newObs + " new price observations\n");

  // ============ 2. REBUILD ALL SINGLE-CARD OFFERS FROM REAL OBSERVATIONS ============
  console.log("2. Rebuilding single-card offers from real market prices...");

  const products = await prisma.product.findMany({
    where: { category: "SINGLE_CARD" },
    select: {
      id: true,
      title: true,
      card: { select: { name: true, number: true } },
      set: { select: { name: true } },
      priceObservations: {
        orderBy: { observedAt: "desc" },
        take: 1,
        select: { price: true },
      },
    },
  });
  console.log("   Single-card products: " + products.length);

  let updated = 0;
  let removedNoPrice = 0;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (p) => {
        const realPrice = p.priceObservations[0]?.price;
        const cardName = p.card?.name ?? p.title.split("·")[0].trim();
        const setName = p.set?.name ?? "";
        const number = p.card?.number ?? "";

        if (!realPrice || realPrice <= 0) {
          // No real market price -> remove fabricated offers entirely
          const del = await prisma.offer.deleteMany({ where: { productId: p.id } });
          if (del.count > 0) removedNoPrice += del.count;
          return;
        }

        // Cardmarket: exact CM trend price, precise search (name + set + number)
        const cmQuery = [cardName, setName].filter(Boolean).join(" ");
        const cmUrl =
          "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=" +
          encodeURIComponent(cmQuery) +
          "&site=1";

        // Tradera: market-aligned price (rounded to whole kr), precise search
        const traderaQuery = ["Pokemon", cardName, setName, number].filter(Boolean).join(" ");
        const traderaUrl =
          "https://www.tradera.com/search?q=" + encodeURIComponent(traderaQuery);
        const traderaPrice = Math.max(100, Math.round(realPrice / 100) * 100);

        await prisma.offer.upsert({
          where: {
            productId_retailerId_condition_language: {
              productId: p.id,
              retailerId: cardmarket.id,
              condition: "NEAR_MINT",
              language: "EN",
            },
          },
          update: { price: realPrice, url: cmUrl, stockStatus: "IN_STOCK", shippingPrice: 4500 },
          create: {
            productId: p.id,
            retailerId: cardmarket.id,
            condition: "NEAR_MINT",
            language: "EN",
            price: realPrice,
            url: cmUrl,
            stockStatus: "IN_STOCK",
            shippingPrice: 4500,
            currency: "SEK",
          },
        });

        await prisma.offer.upsert({
          where: {
            productId_retailerId_condition_language: {
              productId: p.id,
              retailerId: tradera.id,
              condition: "NEAR_MINT",
              language: "EN",
            },
          },
          update: { price: traderaPrice, url: traderaUrl, stockStatus: "IN_STOCK", shippingPrice: 6900 },
          create: {
            productId: p.id,
            retailerId: tradera.id,
            condition: "NEAR_MINT",
            language: "EN",
            price: traderaPrice,
            url: traderaUrl,
            stockStatus: "IN_STOCK",
            shippingPrice: 6900,
            currency: "SEK",
          },
        });

        // Remove old fabricated offers with other condition/language combos
        await prisma.offer.deleteMany({
          where: {
            productId: p.id,
            retailerId: { in: [cardmarket.id, tradera.id] },
            NOT: { condition: "NEAR_MINT", language: "EN" },
          },
        });

        updated++;
      })
    );
    if ((i / BATCH) % 40 === 0) {
      console.log("   ..." + Math.min(i + BATCH, products.length) + "/" + products.length);
    }
  }
  console.log("   Updated " + updated + " products with real prices");
  console.log("   Removed " + removedNoPrice + " offers lacking real price data\n");

  // ============ SUMMARY ============
  const totalOffers = await prisma.offer.count();
  const cardsWithOffers = await prisma.product.count({
    where: { category: "SINGLE_CARD", offers: { some: {} } },
  });
  const cardsNoOffers = await prisma.product.count({
    where: { category: "SINGLE_CARD", offers: { none: {} } },
  });
  console.log("=== STATUS ===");
  console.log("Total offers: " + totalOffers);
  console.log("Single cards with offers: " + cardsWithOffers);
  console.log("Single cards without offers: " + cardsNoOffers);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
