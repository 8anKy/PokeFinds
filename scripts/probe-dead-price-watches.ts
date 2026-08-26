import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const [withTarget, blankTarget, blankActive] = await Promise.all([
    prisma.watchlistItem.count({ where: { priceAlert: true, targetPrice: { not: null } } }),
    prisma.watchlistItem.count({ where: { priceAlert: true, targetPrice: null } }),
    prisma.watchlistItem.count({ where: { priceAlert: true, targetPrice: null, isPaused: false } }),
  ]);
  const users = await prisma.watchlistItem.findMany({
    where: { priceAlert: true, targetPrice: null, isPaused: false },
    select: { userId: true },
    distinct: ["userId"],
  });
  console.log(`priceAlert=true MED malpris:   ${withTarget}`);
  console.log(`priceAlert=true UTAN malpris:  ${blankTarget}  (aktiva: ${blankActive})`);
  console.log(`beroerda anvandare:            ${users.length}`);
}
main().finally(() => prisma.$disconnect());
