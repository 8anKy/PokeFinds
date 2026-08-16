/**
 * DELTA-MÄTNING för en enda regel: räknas "protective" som ett skyddsord?
 *
 * Bakgrund: `PROTECTOR_SIGNS` kände `protector(s)` men inte adjektivet, så Hobbykorts
 * fem "Pokémon Protective Case - Booster Box/ETB/Mini Tin Display" passerade HELA
 * vaktkedjan (formordet "Booster Box" gav dem till och med en giltig kategori). De är
 * plastskydd, inte produkter — och de kunde både bli katalogprodukter och postas som
 * restock-larm i Discord.
 *
 * ⛔ MÄT DELTAT, INTE HELA VAKTEN (läxan från Re-Ment-regeln 2026-08-16): en mätning
 * av `isAccessoryListing` i sin helhet visar mängder av träffar som varken är nya
 * eller fel, och då förkastas en korrekt regel.
 *
 * Kör: node scripts/with-prod-db.mjs npx tsx scripts/measure-protective-guard.ts
 */
import "./load-env";
import { prisma } from "../src/lib/db";

const RULE = /\bprotective\b/i;

async function main() {
  const products = await prisma.product.findMany({
    where: { title: { contains: "protective", mode: "insensitive" } },
    select: { title: true, category: true, slug: true, hiddenAt: true },
  });
  console.log(`=== FACIT 1: KATALOGEN — produkter vars titel innehåller "protective" ===`);
  const hits = products.filter((p) => RULE.test(p.title));
  console.log(`${hits.length} träffar (av ${products.length} med ordet någonstans)\n`);
  for (const p of hits) {
    console.log(`  [${p.category}${p.hiddenAt ? "/GÖMD" : ""}] ${p.title}  (/produkter/${p.slug})`);
  }

  const listings = await prisma.storeListing.findMany({
    where: { title: { contains: "protective", mode: "insensitive" } },
    select: { title: true, url: true, productId: true, retailer: { select: { name: true } } },
  });
  console.log(`\n=== FACIT 2: HUVUDBOKEN — annonser med ordet ===`);
  const lHits = listings.filter((l) => RULE.test(l.title));
  console.log(`${lHits.length} träffar, varav ${lHits.filter((l) => l.productId).length} redan bundna till en produkt\n`);
  for (const l of lHits) {
    console.log(`  ${l.retailer.name}: ${l.title}${l.productId ? "  [BUNDEN]" : ""}`);
  }

  const offers = await prisma.offer.findMany({
    where: { product: { title: { contains: "protective", mode: "insensitive" } } },
    select: { url: true, product: { select: { title: true } }, retailer: { select: { name: true } } },
  });
  console.log(`\n=== OFFERS som skulle förlora sin länk ===`);
  for (const o of offers.filter((o) => RULE.test(o.product.title))) {
    console.log(`  ${o.retailer.name}: ${o.product.title} → ${o.url}`);
  }
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
