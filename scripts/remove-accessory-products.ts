// Tar bort tillbehörsprodukter (samlarpärmar, sleeves, playmats, toploaders,
// deck boxes m.m.) ur katalogen — de är varken singlar eller sealed och ska
// inte ge restock-alerts. classifyForm är samma vakt som import-skripten.
// Dry-run default; sätt APPLY=1 för att radera (cascade tar offers/alerts/watchlist).
import { prisma } from "../src/lib/db";

const APPLY = process.env.APPLY === "1";

async function main() {
  // Category ACCESSORY = pärmar/sleeves/playmats m.m. (redan HIDDEN_CATEGORIES men
  // restock-scannern alarmar ändå på deras offers). Sealed-blisters med mini-album
  // ligger som BLISTER och rörs inte.
  const accessories = await prisma.product.findMany({
    where: { category: "ACCESSORY" },
    select: { id: true, title: true, category: true },
  });

  console.log(`Hittade ${accessories.length} tillbehörsprodukter:`);
  for (const p of accessories) console.log(`  [${p.category}] ${p.title}`);

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
