import { prisma } from "../src/lib/db";
async function main() {
  const set = await prisma.cardSet.findFirst({
    where: { externalId: "me5" },
    select: { id: true, name: true, totalCards: true, _count: { select: { cards: true, products: true } } },
  });
  if (!set) throw new Error("hittades inte");
  console.log(`${set.name}: Card-rader=${set._count.cards}  totalCards(printed)=${set.totalCards}  Product-rader(alla kategorier)=${set._count.products}`);

  const byCat = await prisma.product.groupBy({
    by: ["category"], where: { setId: set.id }, _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  console.log("\nProdukter per kategori:");
  for (const c of byCat) console.log(`  ${c.category}: ${c._count._all}`);

  const byVariant = await prisma.product.groupBy({
    by: ["variantLabel"], where: { setId: set.id, category: "SINGLE_CARD" }, _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });
  console.log("\nSingelprodukter per variantetikett:");
  for (const v of byVariant) console.log(`  ${v.variantLabel ?? "(bas/ingen etikett)"}: ${v._count._all}`);

  const singles = await prisma.product.findMany({
    where: { setId: set.id, category: "SINGLE_CARD" },
    select: { id: true, cardId: true, variantLabel: true, hiddenAt: true },
  });
  console.log(`\nSingelprodukter: ${singles.length}, varav utan cardId: ${singles.filter((p) => !p.cardId).length}, dolda: ${singles.filter((p) => p.hiddenAt).length}`);
  console.log(`distinkta cardId bland singelprodukter: ${new Set(singles.map((p) => p.cardId)).size}`);

  const rar = await prisma.card.groupBy({ by: ["rarity"], where: { setId: set.id }, _count: { _all: true }, orderBy: { _count: { id: "desc" } } });
  console.log("\nKort per sällsynthet:");
  for (const r of rar) console.log(`  ${r.rarity}: ${r._count._all}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
