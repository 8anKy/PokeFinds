import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const offers = await prisma.offer.findMany({
    where: { retailer: { name: { notIn: ["Cardmarket", "Tradera"] } } },
    select: { url: true, retailer: { select: { name: true } } },
  });
  const byRet = new Map<string, Map<string, number>>();
  for (const o of offers) {
    const host = byRet.get(o.retailer.name) ?? new Map();
    const key = (o.url ?? "null").split("?")[0];
    host.set(key, (host.get(key) ?? 0) + 1);
    byRet.set(o.retailer.name, host);
  }
  for (const [r, m] of byRet) {
    console.log(r + ":");
    for (const [u, c] of [...m].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log("  " + c + "x " + u);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
