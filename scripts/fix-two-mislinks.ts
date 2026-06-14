import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const cases = [
    { title: "Escavalier · Black Bolt 60/86", cardName: "Escavalier", setName: "Black Bolt" },
    { title: "Venusaur · Celebrations: Classic Collection 15/25", cardName: "Venusaur", setName: "Celebrations: Classic Collection" },
  ];
  for (const c of cases) {
    const p = await prisma.product.findFirst({ where: { title: c.title }, select: { id: true } });
    if (!p) { console.log("NOT FOUND: " + c.title); continue; }
    const correct = await prisma.card.findFirst({
      where: { name: c.cardName, set: { name: c.setName } },
      select: { id: true, name: true, number: true, imageUrl: true },
    });
    if (!correct) {
      // No such card in our DB -> unlink and delete contaminated offers/observations
      await prisma.offer.deleteMany({ where: { productId: p.id } });
      await prisma.priceObservation.deleteMany({ where: { productId: p.id } });
      await prisma.product.update({ where: { id: p.id }, data: { cardId: null } });
      console.log("UNLINKED (no correct card found, removed offers): " + c.title);
      continue;
    }
    // Does the correct card already have its own product? If so this product is a dupe of wrong data -> delete it
    const existing = await prisma.product.findFirst({
      where: { cardId: correct.id, NOT: { id: p.id } },
      select: { id: true, title: true },
    });
    if (existing) {
      await prisma.offer.deleteMany({ where: { productId: p.id } });
      await prisma.priceObservation.deleteMany({ where: { productId: p.id } });
      await prisma.priceSnapshot.deleteMany({ where: { productId: p.id } });
      await prisma.watchlistItem.deleteMany({ where: { productId: p.id } });
      await prisma.product.delete({ where: { id: p.id } });
      console.log("DELETED dupe \"" + c.title + "\" (correct card already has product \"" + existing.title + "\")");
    } else {
      await prisma.offer.deleteMany({ where: { productId: p.id } });
      await prisma.priceObservation.deleteMany({ where: { productId: p.id } });
      await prisma.product.update({
        where: { id: p.id },
        data: { cardId: correct.id, imageUrl: correct.imageUrl },
      });
      console.log("RELINKED " + c.title + " -> " + correct.name + " " + correct.number + " (offers cleared, will lack price until next observation)");
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
