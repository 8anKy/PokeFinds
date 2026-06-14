import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Products with cardId but no imageUrl — copy from card.imageUrl
  const products = await prisma.product.findMany({
    where: { imageUrl: null, cardId: { not: null } },
    select: { id: true, card: { select: { imageUrl: true } } },
  });
  console.log("Products missing image with linked card:", products.length);
  let fixed = 0, noImg = 0;
  for (const p of products) {
    if (p.card?.imageUrl) {
      await prisma.product.update({ where: { id: p.id }, data: { imageUrl: p.card.imageUrl } });
      fixed++;
    } else noImg++;
  }
  console.log("Fixed:", fixed, "| Card had no image:", noImg);

  // Check how many Ascended Heroes cards have images now
  const set = await prisma.cardSet.findFirst({ where: { name: "Ascended Heroes" } });
  if (set) {
    const total = await prisma.product.count({ where: { setId: set.id } });
    const withImg = await prisma.product.count({ where: { setId: set.id, imageUrl: { not: null } } });
    console.log(`Ascended Heroes: ${withImg}/${total} products have images`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
