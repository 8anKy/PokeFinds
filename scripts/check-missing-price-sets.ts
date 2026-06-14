import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Which sets have products without offers?
  const prods = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", offers: { none: {} } },
    select: { set: { select: { id: true, name: true, externalId: true } } },
  });
  const bySet = new Map<string, { name: string; externalId: string | null; count: number }>();
  for (const p of prods) {
    if (!p.set) continue;
    const e = bySet.get(p.set.id) ?? { name: p.set.name, externalId: p.set.externalId, count: 0 };
    e.count++;
    bySet.set(p.set.id, e);
  }
  for (const [, v] of bySet) console.log(`${v.name} (${v.externalId}): ${v.count} products without offers`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
