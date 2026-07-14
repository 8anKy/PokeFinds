// Tar bort tillbehörsprodukter (samlarpärmar, sleeves, playmats, toploaders,
// deck boxes m.m.) ur katalogen — de är varken singlar eller sealed och ska
// inte ge restock-alerts.
// Dry-run default; sätt APPLY=1 för att radera (cascade tar offers/alerts/watchlist).
//
// TVÅ KÄLLOR, för category=ACCESSORY räcker inte (mätt 2026-07-14):
//   1. category = ACCESSORY  — redan rätt taggade.
//   2. FELTAGGADE: titeln är ett tillbehör men raden ligger som SEALED. De smet in
//      för att titeln bär ett sealed-ord: "Ultra Pro BOOSTER PACK UV ONETOUCH Magnetic
//      Holder" (BOOSTER_PACK), "Evoretro PET Protectors for Pokemon BOOSTER DISPLAY
//      Boxes" (BOOSTER_BOX). isAccessoryListing dömer på titeln, inte på kategorin.
import { prisma } from "../src/lib/db";
import { isAccessoryListing } from "../src/scrapers/matching";

const APPLY = process.env.APPLY === "1";
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "COLLECTION_BOX", "TIN", "BLISTER", "BUNDLE", "OTHER"] as const;

async function main() {
  const tagged = await prisma.product.findMany({
    where: { category: "ACCESSORY" },
    select: { id: true, title: true, category: true },
  });

  const sealed = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: { id: true, title: true, category: true },
  });
  const mislabelled = sealed.filter((p) => isAccessoryListing(p.title));

  const accessories = [...tagged, ...mislabelled];
  console.log(`Hittade ${accessories.length} tillbehörsprodukter (${tagged.length} taggade, ${mislabelled.length} FELTAGGADE som sealed):`);
  for (const p of tagged) console.log(`  [${p.category}] ${p.title}`);
  for (const p of mislabelled) console.log(`  [${p.category}] ⚠ FELTAGGAD: ${p.title}`);

  if (!accessories.length) return;
  if (!APPLY) {
    console.log("\nDry-run. Kör med APPLY=1 för att radera.");
    return;
  }

  const { count } = await prisma.product.deleteMany({
    where: { id: { in: accessories.map((p) => p.id) } },
  });
  console.log(`\nRaderade ${count} produkter.`);
}

main().finally(() => prisma.$disconnect());
