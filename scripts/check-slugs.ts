import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const sealed = await p.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: { slug: true, title: true },
    take: 5,
  });
  for (const s of sealed) console.log(s.slug + " | " + s.title);

  // Product with most offers
  const multi = await p.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    include: { offers: { include: { retailer: true } }, _count: { select: { offers: true } } },
    orderBy: { offers: { _count: "desc" } },
    take: 3,
  });
  for (const m of multi) {
    console.log("\n" + m.slug + " (" + m._count.offers + " offers)");
    for (const o of m.offers) {
      if (o.price === null) continue;
      console.log("  " + o.retailer.name + ": " + (o.price/100) + "kr " + o.stockStatus + " | " + o.url.slice(0, 70));
    }
  }
}
main().finally(() => p.$disconnect());
