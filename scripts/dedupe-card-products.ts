/**
 * Slår ihop dubblett-produkter för samma kort (samma cardId, kategori
 * SINGLE_CARD). Dubbletter uppstod när importen skapade produkter med
 * set-id-slug medan seeden använt set-namn-slug.
 *
 * Den ÄLDSTA produkten behålls (den kan ha bevakningar, offers, visningar).
 * Prisobservationer, offers, snapshots, restocks och bevakningar flyttas
 * över; krockande offers/bevakningar raderas. Dubbletten tas bort.
 *
 * Körs med: npx tsx scripts/dedupe-card-products.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dups = await prisma.product.groupBy({
    by: ["cardId"],
    where: { category: "SINGLE_CARD", cardId: { not: null } },
    having: { cardId: { _count: { gt: 1 } } },
    _count: true,
  });
  console.log(`Hittade ${dups.length} kort med dubblett-produkter`);

  let merged = 0;
  for (const d of dups) {
    const products = await prisma.product.findMany({
      where: { cardId: d.cardId, category: "SINGLE_CARD" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const keeper = products[0];
    const losers = products.slice(1).map((p) => p.id);

    await prisma.$transaction(async (tx) => {
      // Flytta prisobservationer och snapshots (inga unika krockar)
      await tx.priceObservation.updateMany({
        where: { productId: { in: losers } },
        data: { productId: keeper.id },
      });
      // Offers: flytta bara de som inte krockar med keeperns unika nyckel
      const keeperOffers = await tx.offer.findMany({
        where: { productId: keeper.id },
        select: { retailerId: true, condition: true, language: true },
      });
      const taken = new Set(
        keeperOffers.map((o) => `${o.retailerId}|${o.condition}|${o.language}`)
      );
      const loserOffers = await tx.offer.findMany({
        where: { productId: { in: losers } },
        select: { id: true, retailerId: true, condition: true, language: true },
      });
      for (const o of loserOffers) {
        const key = `${o.retailerId}|${o.condition}|${o.language}`;
        if (taken.has(key)) {
          await tx.offer.delete({ where: { id: o.id } });
        } else {
          await tx.offer.update({ where: { id: o.id }, data: { productId: keeper.id } });
          taken.add(key);
        }
      }
      // Bevakningar: flytta om användaren inte redan bevakar keepern
      const keeperWatch = await tx.watchlistItem.findMany({
        where: { productId: keeper.id },
        select: { userId: true },
      });
      const watchTaken = new Set(keeperWatch.map((w) => w.userId));
      const loserWatch = await tx.watchlistItem.findMany({
        where: { productId: { in: losers } },
        select: { id: true, userId: true },
      });
      for (const w of loserWatch) {
        if (watchTaken.has(w.userId)) {
          await tx.watchlistItem.delete({ where: { id: w.id } });
        } else {
          await tx.watchlistItem.update({ where: { id: w.id }, data: { productId: keeper.id } });
          watchTaken.add(w.userId);
        }
      }
      // Resten raderas via cascade när dubbletten tas bort
      await tx.product.deleteMany({ where: { id: { in: losers } } });
    });
    merged++;
    if (merged % 100 === 0) console.log(`  ${merged}/${dups.length}...`);
  }

  console.log(`🎉 Klart! ${merged} dubbletter ihopslagna.`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
