import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
async function main() {
  const prods = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", cardId: { not: null } },
    select: { id: true, title: true, card: { select: { id: true, name: true, number: true, set: { select: { name: true } } } } },
  });
  const bad = prods.filter(p => {
    const t = norm(p.title);
    const first = norm(p.card!.name.split(" ")[0]);
    return first.length >= 3 && !t.includes(first);
  });
  console.log("Products whose title doesn't contain card name: " + bad.length);
  for (const p of bad.slice(0, 40)) {
    console.log('  "' + p.title + '" -> card: ' + p.card!.name + " " + p.card!.number + " (" + p.card!.set?.name + ")");
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
