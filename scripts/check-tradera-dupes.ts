import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Products that came from Tradera listings (title artifacts)
  const traderaProds = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: "Tradera", mode: "insensitive" } },
        { title: { contains: "Såld", mode: "insensitive" } },
        { slug: { contains: "sald" } },
      ],
    },
    select: { id: true, title: true, category: true, imageUrl: true, cardId: true,
      offers: { select: { id: true } } },
  });
  console.log("Tradera-artifact products:", traderaProds.length);
  const byCategory = new Map<string, number>();
  for (const p of traderaProds) {
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  }
  for (const [cat, n] of byCategory) console.log("  " + cat + ": " + n);
  console.log("\nSamples:");
  for (const p of traderaProds.slice(0, 10)) {
    console.log("  " + p.category + " | offers:" + p.offers.length + " | " + p.title.slice(0, 70));
  }
  // Products with 0/null lowest price (no offers) that are NOT new-set cards
  const noOffers = await prisma.product.count({ where: { offers: { none: {} } } });
  console.log("\nTotal products without offers:", noOffers);
}
main().catch(console.error).finally(() => prisma.$disconnect());
