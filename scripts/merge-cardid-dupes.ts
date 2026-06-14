import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const dupes = await prisma.product.groupBy({
    by: ["cardId"],
    where: { cardId: { not: null } },
    _count: true,
    having: { cardId: { _count: { gt: 1 } } },
  });
  console.log("Cards with multiple products:", dupes.length);

  let deleted = 0;
  for (const d of dupes) {
    const prods = await prisma.product.findMany({
      where: { cardId: d.cardId },
      include: { offers: true },
      orderBy: { offers: { _count: "desc" } },
    });
    // Keep: prefer the one with most offers; tiebreak canonical "·" title
    const sorted = [...prods].sort((a, b) =>
      b.offers.length - a.offers.length ||
      (b.title.includes("·") ? 1 : 0) - (a.title.includes("·") ? 1 : 0)
    );
    const keeper = sorted[0];
    for (const dupe of sorted.slice(1)) {
      for (const offer of dupe.offers) {
        const existing = await prisma.offer.findFirst({
          where: { productId: keeper.id, retailerId: offer.retailerId, condition: offer.condition, language: offer.language },
        });
        if (!existing) {
          await prisma.offer.update({ where: { id: offer.id }, data: { productId: keeper.id } });
        } else {
          await prisma.offer.delete({ where: { id: offer.id } });
        }
      }
      await prisma.priceObservation.deleteMany({ where: { productId: dupe.id } });
      await prisma.priceSnapshot.deleteMany({ where: { productId: dupe.id } });
      await prisma.watchlistItem.deleteMany({ where: { productId: dupe.id } });
      await prisma.collectionItem.deleteMany({ where: { productId: dupe.id } });
      await prisma.restockEvent.deleteMany({ where: { productId: dupe.id } });
      await prisma.alert.deleteMany({ where: { productId: dupe.id } });
      await prisma.product.delete({ where: { id: dupe.id } });
      deleted++;
      console.log("Merged: " + dupe.title.slice(0, 55) + " -> " + keeper.title.slice(0, 45));
    }
  }
  console.log("\nDeleted " + deleted + " duplicate products");
}
main().catch(console.error).finally(() => prisma.$disconnect());
