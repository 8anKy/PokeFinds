/**
 * Fetch real Cardmarket prices for products still missing offers and create
 * PriceObservation + Cardmarket/Tradera offers for them.
 */
import { PrismaClient } from "@prisma/client";
import {
  fetchTcgCardsForSet,
  cardMarketPriceOre,
} from "../src/scrapers/adapters/pokemontcg-adapter";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();

async function main() {
  await getRatesOre(); // live EUR/USD-kurs → cardMarketPriceOre läser den synkront
  const cardmarket = await prisma.retailer.findUnique({ where: { name: "Cardmarket" } });
  const tradera = await prisma.retailer.findUnique({ where: { name: "Tradera" } });
  if (!cardmarket || !tradera) throw new Error("Retailers missing");

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
  console.log("Sets to fetch: " + [...setExternalIds.keys()].join(", "));

  let createdOffers = 0;
  let noPriceData = 0;

  for (const [extId, setInfo] of setExternalIds) {
    try {
      const cards = await fetchTcgCardsForSet(extId, 300);
      console.log(setInfo.name + ": " + cards.length + " cards");
      for (const tcgCard of cards) {
        const priceOre = cardMarketPriceOre(tcgCard);
        const card = await prisma.card.findFirst({
          where: { tcgExternalId: tcgCard.id },
          select: {
            id: true,
            name: true,
            number: true,
            products: { select: { id: true, offers: { select: { id: true }, take: 1 } }, take: 1 },
          },
        });
        const product = card?.products[0];
        if (!product || product.offers.length > 0) continue;
        if (!priceOre) { noPriceData++; continue; }

        await prisma.priceObservation.create({
          data: {
            productId: product.id,
            price: priceOre,
            currency: "SEK",
            condition: "NEAR_MINT",
            rawData: {
              cardId: tcgCard.id,
              cardmarket: tcgCard.cardmarket ?? null,
              tcgplayer: tcgCard.tcgplayer ?? null,
              priceOre,
            },
          },
        });

        const cmQuery = [card!.name, setInfo.name].filter(Boolean).join(" ");
        const cmUrl =
          "https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=" +
          encodeURIComponent(cmQuery) + "&site=1";
        const traderaQuery = ["Pokemon", card!.name, setInfo.name, card!.number].filter(Boolean).join(" ");
        const traderaUrl = "https://www.tradera.com/search?q=" + encodeURIComponent(traderaQuery);
        const traderaPrice = Math.max(100, Math.round(priceOre / 100) * 100);

        await prisma.offer.create({
          data: {
            productId: product.id, retailerId: cardmarket.id,
            condition: "NEAR_MINT", language: "EN",
            price: priceOre, url: cmUrl, stockStatus: "IN_STOCK",
            shippingPrice: 4500, currency: "SEK",
          },
        });
        await prisma.offer.create({
          data: {
            productId: product.id, retailerId: tradera.id,
            condition: "NEAR_MINT", language: "EN",
            price: traderaPrice, url: traderaUrl, stockStatus: "IN_STOCK",
            shippingPrice: 6900, currency: "SEK",
          },
        });
        createdOffers += 2;
      }
    } catch (e) {
      console.log("WARN " + extId + ": " + (e as Error).message?.slice(0, 100));
    }
  }

  console.log("\nCreated offers: " + createdOffers);
  console.log("Cards lacking price data in API: " + noPriceData);

  const stillMissing = await prisma.product.count({
    where: { category: "SINGLE_CARD", offers: { none: {} } },
  });
  console.log("Single cards still without offers: " + stillMissing);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
