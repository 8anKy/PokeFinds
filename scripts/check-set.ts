import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const set = await p.cardSet.findFirst({ where: { name: { contains: "Ascended", mode: "insensitive" } } });
  console.log("Set:", set?.id, set?.name);
  if (!set) { console.log("No set found"); return; }
  
  const withSetId = await p.product.count({ where: { setId: set.id } });
  console.log("Products with setId:", withSetId);
  
  const byTitle = await p.product.count({ 
    where: { normalizedTitle: { contains: "ascended heroes", mode: "insensitive" } } 
  });
  console.log("Products matching title:", byTitle);
  
  const samples = await p.product.findMany({
    where: { setId: set.id },
    select: { title: true, category: true },
    take: 5
  });
  samples.forEach(s => console.log("  setId match:", s.category, s.title.slice(0,60)));
  
  // Check cards from this set via Card model
  const cards = await p.card.count({ where: { setId: set.id } });
  console.log("Cards in set:", cards);
  
  // Check products linked via card
  const cardProducts = await p.product.findMany({
    where: { card: { setId: set.id } },
    select: { id: true, title: true, category: true, setId: true },
    take: 5
  });
  console.log("Products via card->set:", cardProducts.length);
  cardProducts.forEach(s => console.log("  card match:", s.category, s.setId ? "HAS setId" : "NO setId", s.title.slice(0,60)));
  
  // How many products have card with this set but no setId on product?
  const unlinkedCards = await p.product.count({
    where: { card: { setId: set.id }, setId: null }
  });
  console.log("Cards in set but product.setId is null:", unlinkedCards);
}
main().finally(() => p.$disconnect());
