import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // Check how products relate to cards
  const totalProducts = await p.product.count();
  const singleCards = await p.product.count({ where: { category: "SINGLE_CARD" } });
  const withCardId = await p.product.count({ where: { cardId: { not: null } } });
  console.log("Total products:", totalProducts);
  console.log("Single card products:", singleCards);
  console.log("Products with cardId:", withCardId);

  // Check total cards
  const totalCards = await p.card.count();
  console.log("Total cards:", totalCards);
  
  // Cards that have products
  const cardsWithProducts = await p.card.count({ where: { products: { some: {} } } });
  console.log("Cards with products:", cardsWithProducts);
  
  // Sample single card product to see structure
  const sample = await p.product.findFirst({
    where: { category: "SINGLE_CARD" },
    include: { card: { select: { id: true, name: true, setId: true } } }
  });
  console.log("Sample single card:", JSON.stringify({
    title: sample?.title?.slice(0,50),
    cardId: sample?.cardId,
    setId: sample?.setId,
    card: sample?.card
  }, null, 2));
  
  // Check sets with most cards
  const sets = await p.cardSet.findMany({
    select: { id: true, name: true, _count: { select: { cards: true } } },
    orderBy: { cards: { _count: "desc" } },
    take: 5
  });
  console.log("\nTop sets by card count:");
  for (const s of sets) {
    const prodCount = await p.product.count({ where: { setId: s.id } });
    console.log(`  ${s.name}: ${s._count.cards} cards, ${prodCount} products with setId`);
  }
  
  // How many single card products have setId?
  const singleWithSet = await p.product.count({ where: { category: "SINGLE_CARD", setId: { not: null } } });
  console.log("\nSingle card products with setId:", singleWithSet);
  const singleNoSet = await p.product.count({ where: { category: "SINGLE_CARD", setId: null } });
  console.log("Single card products without setId:", singleNoSet);
}
main().finally(() => p.$disconnect());
