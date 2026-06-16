/**
 * Tar bort fabricerade "booster box"-produkter för specialset (.5-set) som
 * ALDRIG fått en booster box i verkligheten (Prismatic Evolutions, Crown
 * Zenith, Paldean Fates, Shrouded Fable, 151). De skapades av den gamla
 * seed-/create-sealed-scriptet som antog att varje huvudset har en box.
 *
 * Säkerhetsvakt: en produkt tas bara bort om den (a) är BOOSTER_BOX, (b) har
 * exakt en av titlarna nedan OCH (c) saknar en riktig Cardmarket-länk
 * (idProduct=) — dvs CM:s katalog listar ingen sådan box → den finns inte.
 *
 * Dry-run default. APPLY=1 för att radera.
 *   npx tsx scripts/remove-fabricated-boxes.ts          # rapport
 *   APPLY=1 npx tsx scripts/remove-fabricated-boxes.ts  # radera
 */
import { prisma } from "../src/lib/db";

const FABRICATED_TITLES = [
  "Pokémon TCG: Prismatic Evolutions Booster Box",
  "Prismatic Evolutions Booster Display (36)",
  "Pokémon TCG: Shrouded Fable Booster Box",
  "Pokémon TCG: Paldean Fates Booster Box",
  "Pokémon TCG: Crown Zenith Booster Box",
  "Pokémon TCG: 151 Booster Box", // den riktiga heter "151 Booster Display (36)"
];

async function main() {
  const apply = process.env.APPLY === "1";
  const candidates = await prisma.product.findMany({
    where: { category: "BOOSTER_BOX", title: { in: FABRICATED_TITLES } },
    select: { id: true, title: true, offers: { select: { url: true } } },
  });

  // Vakt: hoppa över om produkten faktiskt har en riktig CM-länk (då finns den).
  const toDelete = candidates.filter(
    (p) => !p.offers.some((o) => /idProduct=/.test(o.url ?? ""))
  );
  const protectedOut = candidates.filter((p) =>
    p.offers.some((o) => /idProduct=/.test(o.url ?? ""))
  );

  console.log(`Hittade ${candidates.length} matchande titlar.`);
  for (const p of protectedOut) console.log(`  SKYDDAD (har CM idProduct): ${p.title}`);
  console.log(`\nAtt radera (${toDelete.length}):`);
  for (const p of toDelete) console.log(`  - ${p.title}`);

  if (!apply) {
    console.log("\nDRY-RUN — inget raderat. Kör med APPLY=1 för att radera.");
    return;
  }

  const ids = toDelete.map((p) => p.id);
  // CollectionItem cascadar inte garanterat → rensa först.
  await prisma.collectionItem.deleteMany({ where: { productId: { in: ids } } });
  // Offer/PriceObservation/PriceSnapshot/RestockEvent/WatchlistItem cascadar; Alert SetNull.
  const res = await prisma.product.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n✅ Raderade ${res.count} produkter.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
