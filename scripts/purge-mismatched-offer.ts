/**
 * RIOLU-RECEPTET SOM KOMMANDO: ta bort en marknadsplats-offer som bevisligen inte är
 * produkten, och se till att svepet inte återskapar den.
 *
 * Tre steg, och alla tre behövs:
 *   1. radera Offer:n (på offer-ID — aldrig på pris/URL-mönster)
 *   2. TraderaMatch.ok = false för (itemId, productId) → svepet slår upp domen och
 *      återskapar ALDRIG en känd felmatch (raden överlever offer-nollställning)
 *   3. radera de förgiftade PriceObservation-raderna (samma produkt, samma källa,
 *      exakt det priset) → annonsens pris försvinner även ur grafen
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
        id: true, price: true, url: true, productId: true,
        retailer: { select: { name: true } },
        product: { select: { title: true, slug: true, lowestPriceOre: true } },
      },
    });
    if (!offer) {
      console.log(`✗ ${offerId}: finns inte (redan borta?)`);
      continue;
    }
    const itemId = offer.url.match(/\/item\/\d+\/(\d+)/)?.[1] ?? null;
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
    console.log(`    → raderar offer, ${itemId ? "sätter TraderaMatch ok=false" : "INGET itemId → ingen match-spärr"}, ${poisoned} förgiftade observationer`);

    if (!APPLY) continue;

    await prisma.offer.delete({ where: { id: offer.id } });
    if (itemId) {
      await prisma.traderaMatch.upsert({
        where: { itemId_productId: { itemId, productId: offer.productId } },
        update: { ok: false, reason: "manuell purge: annonsen är ett annat föremål" },
        create: { itemId, productId: offer.productId, ok: false, reason: "manuell purge: annonsen är ett annat föremål" },
      });
    }
    if (offer.price != null && source) {
      await prisma.priceObservation.deleteMany({
        where: { productId: offer.productId, sourceId: source.id, price: offer.price },
      });
    }
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
