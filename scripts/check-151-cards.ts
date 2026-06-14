import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const set151 = await prisma.cardSet.findFirst({ where: { name: "151" }, select: { id: true } });
  if (!set151) { console.log("no 151 set"); return; }
  for (const spec of [{ name: "Gengar ex", number: "193" }, { name: "Eevee", number: "167" }, { name: "Venusaur", number: undefined as string | undefined }]) {
    const cards = await prisma.card.findMany({
      where: { setId: set151.id, name: { contains: spec.name }, ...(spec.number ? { number: spec.number } : {}) },
      select: { name: true, number: true, products: { select: { id: true, title: true, offers: { select: { id: true } } } } },
    });
    for (const c of cards) {
      console.log(c.name + " " + c.number + " (151): products=" + c.products.length +
        c.products.map(p => ' ["' + p.title + '" offers=' + p.offers.length + "]").join(""));
    }
    if (cards.length === 0) console.log(spec.name + " " + (spec.number ?? "") + ": no such card in 151");
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
