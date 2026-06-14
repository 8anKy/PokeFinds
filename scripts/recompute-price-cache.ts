import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";
const prisma = new PrismaClient();
async function main() {
  console.time("recompute");
  await recomputeProductPriceCache();
  console.timeEnd("recompute");
  const withPrice = await prisma.product.count({ where: { lowestPriceOre: { not: null }, category: { notIn: ["ACCESSORY","GRADED_CARD","OTHER"] } } });
  const hidden = await prisma.product.count({ where: { lowestPriceOre: null } });
  console.log(`Synliga (med pris, ej dolda kat): ${withPrice}`);
  console.log(`Dolda (utan pris): ${hidden}`);
}
main().finally(() => prisma.$disconnect());
