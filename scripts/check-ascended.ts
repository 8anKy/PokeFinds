import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const set = await p.cardSet.findFirst({ where: { name: "Ascended Heroes" } });
  if (!set) return;
  
  // Cards in Ascended Heroes
  const cards = await p.card.findMany({
    where: { setId: set.id },
    select: { id: true, name: true, products: { select: { id: true } } },
    take: 10
  });
  console.log("Sample Ascended Heroes cards:");
  for (const c of cards) {
    console.log(`  ${c.name}: ${c.products.length} products`);
  }
  
  // Which sets are missing products?
  const allSets = await p.cardSet.findMany({
    select: { id: true, name: true, _count: { select: { cards: true } } },
    orderBy: { name: "asc" }
  });
  console.log("\nSets with cards but few products:");
  for (const s of allSets) {
    const prodCount = await p.product.count({ where: { setId: s.id } });
    if (s._count.cards > 10 && prodCount < s._count.cards / 2) {
      console.log(`  ${s.name}: ${s._count.cards} cards, ${prodCount} products`);
    }
  }
}
main().finally(() => p.$disconnect());
