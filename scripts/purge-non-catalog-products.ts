/**
 * Rensar bort produkter som inte hör hemma i katalogen: TILLBEHÖR och
 * BUTIKSEGNA BUNDLES (mystery packs, "alla fem tins" och liknande).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-non-catalog-products.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-non-catalog-products.ts --apply
 *
 * ⛔ RADERING RÄCKER INTE. Butiken säljer varan vidare, så nästa restock-skanning
 *    skapar produkten igen inom minuter — det var precis så tillbehören kom tillbaka
 *    efter katalogrevisionen 2026-07-14. Varje raderad butiks-URL måste därför också
 *    in i `src/scrapers/import-denylist.ts`; skriptet skriver ut raderna att klistra in.
 *
 * Ägarbeslut 2026-08-07: inga tillbehör, och inga butiksegna bundles alls.
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

/** Produkter som ska bort, med skälet. Slug är stabil och lätt att granska. */
const PURGE: { slug: string; why: string }[] = [
  { slug: "evoretro-pet-protectors-for-pokemon-elite-trainer-boxes-5-pack", why: "tillbehör (plastfodral)" },
  { slug: "evoretro-pet-protectors-for-pokemon-booster-display-boxes-5-pack", why: "tillbehör (plastfodral)" },
  { slug: "swepoke-mystery-pack-1-0-4-booster-packs", why: "butiksegen bundle (mystery pack)" },
  { slug: "pokemon-mini-tin-luminose-city-alla-fem-tins", why: "butiksegen bundle (fem tins i klump)" },
];

async function main() {
  const urls: string[] = [];
  for (const p of PURGE) {
    const prod = await prisma.product.findUnique({
      where: { slug: p.slug },
      select: {
        id: true,
        title: true,
        category: true,
        offers: { select: { id: true, url: true, retailer: { select: { name: true } } } },
        _count: { select: { watchlistItems: true, collectionItems: true, priceSnapshots: true } },
      },
    });
    if (!prod) {
      console.log(`  saknas redan: ${p.slug}`);
      continue;
    }
    console.log(
      `\n  [${prod.category}] ${prod.title}\n     skäl: ${p.why}\n     offers: ${prod.offers.length}, bevakningar: ${prod._count.watchlistItems}, samlingar: ${prod._count.collectionItems}, snapshots: ${prod._count.priceSnapshots}`
    );
    for (const o of prod.offers) {
      console.log(`       ${o.retailer.name}: ${o.url}`);
      if (o.url) urls.push(o.url);
    }
    if (prod._count.watchlistItems > 0 || prod._count.collectionItems > 0) {
      console.log("     ⚠️ NÅGON BEVAKAR ELLER ÄGER DEN — hoppas över, be ägaren avgöra.");
      continue;
    }
    if (!APPLY) continue;
    // Relationer utan cascade måste bort först.
    await prisma.priceObservation.deleteMany({ where: { productId: prod.id } });
    await prisma.priceSnapshot.deleteMany({ where: { productId: prod.id } });
    await prisma.restockEvent.deleteMany({ where: { productId: prod.id } });
    await prisma.alert.deleteMany({ where: { productId: prod.id } });
    await prisma.offer.deleteMany({ where: { productId: prod.id } });
    await prisma.product.delete({ where: { id: prod.id } });
    console.log("     ✓ raderad");
  }

  console.log("\n── Lägg till i import-denylist.ts (annars återskapas de) ──");
  for (const u of urls) console.log(`    "${u}",`);
  if (!APPLY) console.log("\nTorrkörning — inget raderat. Lägg till --apply.");
}

main().finally(() => prisma.$disconnect());
