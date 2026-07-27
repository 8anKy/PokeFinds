/**
 * RIOLU-RECEPTET SOM KOMMANDO: ta bort en marknadsplats-offer som bevisligen inte är
 * produkten, och se till att svepet inte återskapar den.
 *
 * Fem steg, och alla fem behövs:
 *   1. radera Offer:n (på offer-ID — aldrig på pris/URL-mönster)
 *   2. TraderaMatch.ok = false för (itemId, productId) → svepet slår upp domen och
 *      återskapar ALDRIG en känd felmatch (raden överlever offer-nollställning)
 *   3. radera de förgiftade PriceObservation-raderna (samma produkt, samma källa,
 *      exakt det priset) → annonsens pris försvinner även ur grafen
 *   4. radera TraderaListing-raden (produktsidans karusell "Fler annonser på Tradera").
 *      MISSADES 2026-07-26: ramen togs bort ur pristabellen men syntes vidare i
 *      karusellen — 179 kr bredvid ett CM-golv på 3 207 kr. Karusellen skrivs bara om
 *      när produkten namn-söks igen, och rotationen tar ~100 dygn för hela katalogen.
 *   5. lyft fram nästa vettiga annons som offer om produkten har fler kvar. Utan det
 *      står produktsidan med en KARUSELL FULL AV TRADERA-ANNONSER men ingen Tradera-rad
 *      i pristabellen — den ser ut som en bugg, och är det: annonserna finns.
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
import { listingCardLanguage } from "../src/lib/listing-language";
import { listingPriceIsPlausible } from "../src/lib/listing-plausibility";

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
    // Karusellen (samma annons, egen tabell) och ersättaren: alla ANDRA skena-rader
    // för produkten som fortfarande håller mot facit. Billigast först = samma urval
    // som svepet gör när det sätter offerten.
    const cmRefOre = offer.product.offers[0]?.price ?? null;
    const rails = await prisma.traderaListing.findMany({
      where: { productId: offer.productId },
      orderBy: { price: "asc" },
      select: { itemId: true, title: true, price: true, url: true },
    });
    const railHit = itemId ? rails.find((r) => r.itemId === itemId) : undefined;
    const rejected = new Set(
      (await prisma.traderaMatch.findMany({
        where: { productId: offer.productId, ok: false }, select: { itemId: true },
      })).map((m) => m.itemId)
    );
    const replacement = rails.find(
      (r) => r.itemId !== itemId && !rejected.has(r.itemId) && listingPriceIsPlausible(r.price, cmRefOre)
    );

    console.log(`    → raderar offer, ${itemId ? "sätter TraderaMatch ok=false" : "INGET itemId → ingen match-spärr"}, ${poisoned} förgiftade observationer`);
    console.log(`    → karusell: ${railHit ? "raderar skena-raden" : "ingen skena-rad"}, ${rails.length - (railHit ? 1 : 0)} kvar`);
    if (replacement) {
      console.log(`    → ersätter offerten med ${(replacement.price / 100).toFixed(2)} kr — "${replacement.title}"`);
    } else if (rails.length > (railHit ? 1 : 0)) {
      console.log(`    → INGEN ersättare klarar facit (${cmRefOre != null ? (cmRefOre / 100).toFixed(2) + " kr" : "inget facit"}) → produkten blir utan Tradera-rad`);
    }

    if (!APPLY) continue;

    await prisma.offer.delete({ where: { id: offer.id } });
    if (itemId) {
      await prisma.traderaMatch.upsert({
        where: { itemId_productId: { itemId, productId: offer.productId } },
        update: { ok: false, reason: "manuell purge: annonsen är ett annat föremål" },
        create: { itemId, productId: offer.productId, ok: false, reason: "manuell purge: annonsen är ett annat föremål" },
      });
      await prisma.traderaListing.deleteMany({ where: { productId: offer.productId, itemId } });
    }
    if (offer.price != null && source) {
      await prisma.priceObservation.deleteMany({
        where: { productId: offer.productId, sourceId: source.id, price: offer.price },
      });
    }
    if (replacement) {
      const condition =
        offer.product.category === "SINGLE_CARD" || offer.product.category === "GRADED_CARD"
          ? "NEAR_MINT" : "SEALED";
      const language = listingCardLanguage(replacement.title, replacement.url);
      await prisma.offer.upsert({
        where: {
          productId_retailerId_condition_language: {
            productId: offer.productId, retailerId: offer.retailerId, condition, language,
          },
        },
        update: { price: replacement.price, currency: "SEK", stockStatus: "IN_STOCK", url: replacement.url, lastSeenAt: new Date() },
        create: {
          productId: offer.productId, retailerId: offer.retailerId, condition, language,
          price: replacement.price, currency: "SEK", stockStatus: "IN_STOCK", url: replacement.url, lastSeenAt: new Date(),
        },
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
