import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Sample 10 products: compare offer prices vs real priceObservation
  const prods = await prisma.product.findMany({
    where: {
      category: "SINGLE_CARD",
      offers: { some: {} },
      priceObservations: { some: {} },
    },
    include: {
      offers: { include: { retailer: { select: { name: true } } } },
      priceObservations: { orderBy: { observedAt: "desc" }, take: 1 },
    },
    take: 10,
  });

  for (const p of prods) {
    const obs = p.priceObservations[0];
    const raw = obs?.rawData as { cardmarket?: { prices?: { trendPrice?: number } } } | null;
    const trend = raw?.cardmarket?.prices?.trendPrice;
    console.log(p.title.slice(0, 55));
    console.log(`  Real obs: ${(obs?.price ?? 0) / 100} kr (CM trend: ${trend ?? "?"} EUR)`);
    for (const o of p.offers) {
      if (o.price === null) continue;
      console.log(`  Offer ${o.retailer.name}: ${o.price / 100} kr`);
    }
  }

  // How many offers vs observations exist
  const obsCount = await prisma.priceObservation.count();
  console.log("\nTotal price observations:", obsCount);
  const prodsWithObs = await prisma.product.count({ where: { priceObservations: { some: {} } } });
  console.log("Products with observations:", prodsWithObs);
  const newCardsNoOffers = await prisma.product.count({ where: { category: "SINGLE_CARD", offers: { none: {} } } });
  console.log("Single cards without offers:", newCardsNoOffers);
}
main().catch(console.error).finally(() => prisma.$disconnect());
