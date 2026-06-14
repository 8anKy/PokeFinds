import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // 1. Spelexperten 2799 on Vileplume 2-pack blister = mismatched booster display
  // 2. Alphaspel 649 on Celebrations ETB = stale seed price (real value ~3300)
  // 3. Webhallen 799 on Evolving Skies PC ETB = stale seed price (collector item)
  const del = await prisma.offer.deleteMany({
    where: {
      OR: [
        { product: { title: { contains: "Enhanced 2-Pack Blister Vileplume" } }, retailer: { name: "Spelexperten" } },
        { product: { title: { contains: "Celebrations 25th Anniversary Elite Trainer Box" } }, retailer: { name: "Alphaspel" } },
        { product: { title: { contains: "Evolving Skies Pokemon Center Elite Trainer Box" } }, retailer: { name: "Webhallen" } },
      ],
    },
  });
  console.log("Deleted: " + del.count);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
