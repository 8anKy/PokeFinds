/**
 * Sanerar Tradera-offers vars pris är orimligt högt jämfört med produktens
 * Cardmarket-marknadspris (> MARKETPLACE_MAX_PRICE_RATIO ×) — nästan alltid
 * lots med flera enheter som inte framgår av titeln (t.ex. "Pokémon Booster
 * Bundle Ascended Heroes" = 4 bundles för 4 200 kr). Offerten nollas till
 * länk-offer (sök-URL, price=null) och lot-observationerna raderas.
 *
 * Dry-run som standard. Kör skarpt: APPLY=1 npx tsx --env-file=.env scripts/clean-implausible-tradera.ts
 */
import { PrismaClient } from "@prisma/client";
import { isPlausibleListingPrice } from "../src/scrapers/matching";
import { traderaSearchUrl } from "./marketplace-urls";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

async function main() {
  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  const traderaSource = await prisma.scrapeSource.findFirstOrThrow({ where: { name: "Tradera" } });
  const cm = await prisma.retailer.findFirstOrThrow({ where: { name: "Cardmarket" } });

  const offers = await prisma.offer.findMany({
    where: { retailerId: tradera.id, price: { not: null } },
    include: { product: { select: { title: true } } },
  });

  let flagged = 0;
  for (const o of offers) {
    if (o.price == null) continue;
    if (await isPlausibleListingPrice(o.productId, o.price)) continue;
    const cmOffer = await prisma.offer.findFirst({
      where: { productId: o.productId, retailerId: cm.id, price: { not: null } },
      select: { price: true },
    });
    if (cmOffer?.price == null) continue;

    flagged++;
    console.log(
      `${APPLY ? "RENSAR" : "SKULLE RENSA"}: "${o.product.title}" — Tradera ${(o.price / 100).toFixed(0)} kr vs CM ${(cmOffer.price / 100).toFixed(0)} kr (${(o.price / cmOffer.price).toFixed(1)}×)\n  ${o.url}`
    );
    if (!APPLY) continue;

    await prisma.offer.update({
      where: { id: o.id },
      data: {
        price: null,
        shippingPrice: null,
        stockStatus: "UNKNOWN",
        url: traderaSearchUrl(o.product.title),
      },
    });
    const del = await prisma.priceObservation.deleteMany({
      where: { productId: o.productId, sourceId: traderaSource.id, price: o.price },
    });
    console.log(`  → länk-offer; ${del.count} lot-observation(er) raderade`);
  }

  console.log(`\n${flagged} orimliga Tradera-offers av ${offers.length} prissatta.${APPLY ? "" : " (dry-run — kör med APPLY=1)"}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
