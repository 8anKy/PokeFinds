/**
 * RIOLU-RECEPTET SOM KOMMANDO: ta bort en marknadsplats-offer som bevisligen inte är
 * produkten, och se till att svepet inte återskapar den.
 *
 * Själva receptet (fem steg, alla behövs) bor i `purgeMismatchedMarketplaceOffer`
 * (`src/services/marketplace-offers.ts`) — admin-knappen på produktsidan kallar
 * samma kod. Det här skriptet är batch-varianten med torrkörning och facit-utskrift.
 * Sedan recomputeProductPriceCache() så katalogens lägsta pris följer med.
 *
 * Dry-run som standard. APPLY=1 skriver.
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-mismatched-offer.ts <offerId> [...]
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/purge-mismatched-offer.ts <offerId> [...]
 *
 * ANVÄND BARA när annonsen bevisligen är ett ANNAT föremål (tillbehör, annat
 * kortnummer, gradad slab på en raw-produkt). Ett lågt pris är INTE bevis: ett spelat
 * vintage-exemplar säljs lagligt för en bråkdel av NM-golvet. Och kontrollera först att
 * det inte är CM-priset som är uppblåst — se marketplace-underprice-report.ts.
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";
import {
  findReplacementListing,
  listingItemIdFromUrl,
  purgeMismatchedMarketplaceOffer,
} from "../src/services/marketplace-offers";

const APPLY = process.env.APPLY === "1";
const OFFER_IDS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function main() {
  if (OFFER_IDS.length === 0) {
    console.error("Ange minst ett offer-ID.");
    process.exit(1);
  }
  console.log(APPLY ? "LÄGE: SKRIVER\n" : "LÄGE: TORRKÖRNING (APPLY=1 för att skriva)\n");

  let removed = 0;
  for (const offerId of OFFER_IDS) {
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      select: {
        id: true, price: true, url: true, productId: true, retailerId: true,
        retailer: { select: { name: true } },
        product: {
          select: {
            title: true, slug: true, lowestPriceOre: true, category: true,
            offers: {
              where: { price: { not: null }, retailer: { name: "Cardmarket" } },
              select: { price: true }, take: 1,
            },
          },
        },
      },
    });
    if (!offer) {
      console.log(`✗ ${offerId}: finns inte (redan borta?)`);
      continue;
    }
    const itemId = listingItemIdFromUrl(offer.url);
    const source = await prisma.scrapeSource.findFirst({
      where: { name: offer.retailer.name }, select: { id: true },
    });
    const poisoned = offer.price != null && source
      ? await prisma.priceObservation.count({
          where: { productId: offer.productId, sourceId: source.id, price: offer.price },
        })
      : 0;

    console.log(`• ${offer.product.title}  (/produkter/${offer.product.slug})`);
    console.log(`    ${offer.retailer.name} ${offer.price != null ? (offer.price / 100).toFixed(2) + " kr" : "utan pris"}  item=${itemId ?? "–"}`);
    console.log(`    ${offer.url}`);
    // Karusellen (samma annons, egen tabell) och ersättaren: nästa vettiga annons
    // ur samma kandidatlista svepet redan vaktat.
    const cmRefOre = offer.product.offers[0]?.price ?? null;
    const rails = await prisma.traderaListing.findMany({
      where: { productId: offer.productId }, select: { itemId: true },
    });
    const railHit = itemId ? rails.find((r) => r.itemId === itemId) : undefined;
    const replacement = await findReplacementListing(offer.productId, itemId);

    console.log(`    → raderar offer, ${itemId ? "sätter TraderaMatch ok=false" : "INGET itemId → ingen match-spärr"}, ${poisoned} förgiftade observationer`);
    console.log(`    → karusell: ${railHit ? "raderar skena-raden" : "ingen skena-rad"}, ${rails.length - (railHit ? 1 : 0)} kvar`);
    if (replacement) {
      console.log(`    → ersätter offerten med ${(replacement.price / 100).toFixed(2)} kr — "${replacement.title}"`);
    } else if (rails.length > (railHit ? 1 : 0)) {
      console.log(`    → INGEN ersättare klarar facit (${cmRefOre != null ? (cmRefOre / 100).toFixed(2) + " kr" : "inget facit"}) → produkten blir utan Tradera-rad`);
    }

    if (!APPLY) continue;

    const purged = await purgeMismatchedMarketplaceOffer(
      {
        id: offer.id,
        productId: offer.productId,
        price: offer.price,
        url: offer.url,
        retailerId: offer.retailerId,
        retailerName: offer.retailer.name,
        productCategory: offer.product.category,
      },
      "manuell purge: annonsen är ett annat föremål"
    );
    // Ingen annons-identitet (butiks-offer) → receptet gäller inte, radera rakt av.
    if (!purged) await prisma.offer.delete({ where: { id: offer.id } });
    removed++;
  }

  if (APPLY && removed > 0) {
    await recomputeProductPriceCache();
    console.log(`\n${removed} offers borta, prischachen omräknad.`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
