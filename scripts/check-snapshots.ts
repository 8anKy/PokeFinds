import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.priceSnapshot.count();
  console.log("Total snapshots:", count);
  // Sample one product's snapshots vs its real obs
  const prod = await prisma.product.findFirst({
    where: { category: "SINGLE_CARD", priceSnapshots: { some: {} }, priceObservations: { some: {} } },
    include: {
      priceSnapshots: { orderBy: { date: "desc" }, take: 5 },
      priceObservations: { orderBy: { observedAt: "desc" }, take: 1 },
    },
  });
  console.log("Product:", prod?.title.slice(0, 50));
  console.log("Real obs price:", (prod?.priceObservations[0]?.price ?? 0) / 100, "kr");
  for (const s of prod?.priceSnapshots ?? []) {
    console.log(`  ${s.date.toISOString().slice(0,10)}: min ${s.minPrice/100} avg ${s.avgPrice/100} max ${s.maxPrice/100}`);
  }
  const prodsWithSnap = await prisma.product.count({ where: { priceSnapshots: { some: {} } } });
  console.log("Products with snapshots:", prodsWithSnap);
}
main().catch(console.error).finally(() => prisma.$disconnect());
