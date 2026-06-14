import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const set = await p.cardSet.findFirst({ where: { name: "Ascended Heroes" } });
  console.log("Set ID:", set?.id);
}
main().finally(() => p.$disconnect());
