/**
 * Raderar butiks-offers som pekar på SÖKSIDOR i stället för produktsidor.
 *
 * Bakgrund: projektets egen regel är "offers = endast direkta länkar" — en sök-/
 * bläddringslänk är inget erbjudande. `isDirectOfferUrl()` döljer dem redan i UI och i
 * prisstatistiken, så de gör ingen synlig skada, MEN de ligger kvar som Offer-rader med
 * ett PRIS satt, de bär ingen streckkod, och de får täckningsmätningar att ljuga om vad
 * som ens är nåbart. Hittades 2026-07-13 när GTIN-backfillen försökte hämta streckkoder
 * från dem (Alphaspel såg ut att ha 40% täckning i stället för uppmätta 82%).
 *
 * TRADERA UNDANTAS. Deras söklänkar (~4800) är den MEDVETNA "Sök på Tradera"-fallbacken
 * och saknar pris. De ska inte bort.
 *
 * VAKT: raderar aldrig en produkts SISTA offer — då hade produkten fallit ur katalogen
 * (lowestPriceOre → null → gömd). En osynlig produkt är värre än en dold skräplänk.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-search-offers.ts          # dry-run
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-search-offers.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { isDirectOfferUrl } from "../src/lib/marketplace-urls";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Marknadsplatsen vars söklänkar är en avsiktlig fallback, inte skräp. */
const KEEP_SEARCH_LINKS = new Set(["Tradera"]);

async function main() {
  console.log(APPLY ? "APPLY — raderar.\n" : "DRY-RUN — inget raderas. Kör med --apply.\n");

  const offers = await prisma.offer.findMany({
    select: {
      id: true, url: true, price: true, productId: true,
      retailer: { select: { name: true } },
      product: { select: { title: true } },
    },
  });

  const junk = offers.filter(
    (o) => !isDirectOfferUrl(o.url) && !KEEP_SEARCH_LINKS.has(o.retailer.name)
  );

  const toDelete: typeof junk = [];
  const keptLastOffer: typeof junk = [];
  for (const o of junk) {
    // Räkna om PER OFFER vid raderingstillfället — inte från en gammal ögonblicksbild.
    const others = await prisma.offer.count({
      where: { productId: o.productId, id: { not: o.id } },
    });
    (others > 0 ? toDelete : keptLastOffer).push(o);
  }

  const byStore = new Map<string, number>();
  for (const o of toDelete) byStore.set(o.retailer.name, (byStore.get(o.retailer.name) ?? 0) + 1);

  console.log(`${junk.length} butiks-offers pekar på söksidor (Tradera-fallbacken undantagen).`);
  for (const [store, n] of [...byStore.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${store.padEnd(15)} ${n}`);
  }
  console.log(`\n${toDelete.length} raderas · ${keptLastOffer.length} behålls (produktens enda offer).`);
  for (const o of keptLastOffer) {
    console.log(`   BEHÅLLS: ${o.retailer.name} — "${o.product.title.slice(0, 50)}" (skulle bli produkt utan offers)`);
  }

  if (!APPLY) {
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.offer.deleteMany({ where: { id: { in: toDelete.map((o) => o.id) } } });
  console.log(`\n✓ ${res.count} skräp-offers raderade.`);

  // Priserna på de produkterna byggde delvis på söklänkarnas pris → räkna om cachen.
  await recomputeProductPriceCache();
  console.log("✓ Prisscachen omräknad.");

  const left = (await prisma.offer.findMany({ select: { url: true, retailer: { select: { name: true } } } }))
    .filter((o) => !isDirectOfferUrl(o.url) && !KEEP_SEARCH_LINKS.has(o.retailer.name)).length;
  console.log(`Kvar (bör vara ${keptLastOffer.length}): ${left}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
