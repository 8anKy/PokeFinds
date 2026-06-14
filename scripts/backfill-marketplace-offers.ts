/**
 * Säkerställer att VARJE produkt har minst Cardmarket- och Tradera-poster i
 * butikslistan:
 *
 * - Cardmarket (singelkort): riktigt engelskt marknadspris från senaste
 *   PriceObservation (källa "Pokémon TCG API", Cardmarket trend EUR→SEK).
 *   Saknas pris → länk-offer utan pris (price = null) till Cardmarket-sök.
 * - Cardmarket (sealed): länk-offer utan pris (vi fabricerar aldrig priser).
 * - Tradera: länk-offer till sökresultat (auktionspriser varierar → price = null
 *   om det inte redan finns en riktig skrapad Tradera-offer).
 *
 * Befintliga offers rörs inte — scriptet skapar bara det som saknas, samt
 * uppdaterar priset på Cardmarket-offers för singelkort till senaste
 * observationen.
 *
 * Körs med: npx tsx scripts/backfill-marketplace-offers.ts
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import {
  cardmarketExactUrl,
  cardmarketSearchUrl,
  traderaSearchUrl,
  traderaSearchUrlSpecific,
} from "./marketplace-urls";

const prisma = new PrismaClient();

const BATCH = 500;

/** Cachade exakta engelska CM-slug-länkar (resolve-cm-urls.ts), tcgId → url. */
const slugCache: Record<string, string> = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), ".cache", "cm-resolved-urls.json"), "utf8")
    );
  } catch {
    return {};
  }
})();

/** "Pikachu · EX Trainer Kit Latios 6" → söktermer utan interpunkt. */
function searchTerm(title: string): string {
  return title.replace(/\s*·\s*/g, " ").trim();
}

/**
 * Visat singelpris i öre = Cardmarket-MARKNADSPRIS (trend) ur senaste
 * observationen (`observation.price` är redan trend×kurs i öre). Vi använder
 * INTE lowPrice — det är CM:s all-språk/all-skick-golv och underskattar grovt
 * det engelska priset. null om ingen observation finns.
 */
function singleOfferPrice(
  observations: { price: number; rawData: unknown }[]
): number | null {
  return observations[0]?.price ?? null;
}

async function main() {
  const [cardmarket, tradera, tcgSource] = await Promise.all([
    prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } }),
    prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } }),
    prisma.scrapeSource.findFirst({ where: { name: "Pokémon TCG API" } }),
  ]);

  let cmCreated = 0;
  let cmUpdated = 0;
  let trCreated = 0;
  let cursor: string | undefined;

  while (true) {
    const products = await prisma.product.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        title: true,
        category: true,
        card: {
          select: {
            name: true,
            number: true,
            tcgExternalId: true,
            set: { select: { name: true } },
          },
        },
        offers: {
          where: { retailerId: { in: [cardmarket.id, tradera.id] } },
          select: { id: true, retailerId: true, price: true },
        },
        priceObservations: tcgSource
          ? {
              where: { sourceId: tcgSource.id },
              orderBy: { observedAt: "desc" },
              take: 5,
              select: { price: true, rawData: true },
            }
          : false,
      },
    });
    if (products.length === 0) break;
    cursor = products[products.length - 1].id;

    for (const p of products) {
      const isSingle = p.category === "SINGLE_CARD";
      const term = searchTerm(p.title);
      const condition = isSingle ? ("NEAR_MINT" as const) : ("SEALED" as const);
      // Erbjudandepriset = lägsta annonspris ("From" = cardmarket lowPrice) om
      // det finns i rådatan, annars trend-priset. Endast singelkort har CM-pris.
      const marketPrice = isSingle ? singleOfferPrice(p.priceObservations ?? []) : null;

      // CM-länk för singel med TCG-id: cachad exakt engelsk slug (?language=1)
      // om den finns, annars redirecten (döljs i UI tills resolve-cm-urls.ts
      // uppgraderat den). Övrigt: sök-länk (döljs tills den blir direkt).
      const cmUrl =
        isSingle && p.card?.tcgExternalId
          ? slugCache[p.card.tcgExternalId] ?? cardmarketExactUrl(p.card.tcgExternalId)
          : cardmarketSearchUrl(term);

      const cmOffer = p.offers.find((o) => o.retailerId === cardmarket.id);
      if (!cmOffer) {
        await prisma.offer.create({
          data: {
            productId: p.id,
            retailerId: cardmarket.id,
            url: cmUrl,
            price: marketPrice,
            currency: "SEK",
            condition,
            language: "EN",
            stockStatus: marketPrice !== null ? "IN_STOCK" : "UNKNOWN",
            shippingPrice: marketPrice !== null ? 4500 : null,
          },
        });
        cmCreated++;
      } else if (cmOffer.price === null && marketPrice !== null) {
        // Tidigare länk-offer som nu har fått riktigt pris
        await prisma.offer.update({
          where: { id: cmOffer.id },
          data: { price: marketPrice, stockStatus: "IN_STOCK", shippingPrice: 4500 },
        });
        cmUpdated++;
      }

      const trOffer = p.offers.find((o) => o.retailerId === tradera.id);
      if (!trOffer) {
        // Specifik sökterm: singlar med kort → "namn set nummer", sealed → titel
        const trTerm = p.card
          ? `${p.card.name} ${p.card.set.name.replace(/^Pokémon\s+TCG:\s*/i, "")} ${p.card.number}`
          : term;
        await prisma.offer.create({
          data: {
            productId: p.id,
            retailerId: tradera.id,
            url: traderaSearchUrlSpecific(trTerm, p.category),
            price: null, // auktionspriser varierar — aldrig fabricerade priser
            currency: "SEK",
            condition,
            language: "EN",
            stockStatus: "UNKNOWN",
          },
        });
        trCreated++;
      }
    }
  }

  console.log(`🎉 Klart!`);
  console.log(`   Cardmarket-offers skapade:    ${cmCreated}`);
  console.log(`   Cardmarket-offers prissatta:  ${cmUpdated}`);
  console.log(`   Tradera-offers skapade:       ${trCreated}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
