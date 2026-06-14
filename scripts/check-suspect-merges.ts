import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  // Suspicious cases: products whose title contains "151" or "Celebrations" but set differs
  const suspects = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: "Gengar ex" } },
        { title: { contains: "Eevee" } },
        { title: { contains: "Team Rocket!" } },
      ],
    },
    select: {
      id: true, title: true,
      set: { select: { name: true } },
      card: { select: { name: true, number: true, set: { select: { name: true } } } },
      offers: { select: { id: true }, take: 1 },
    },
    take: 40,
  });
  for (const p of suspects) {
    console.log('"' + p.title + '" | prodSet=' + (p.set?.name ?? "-") +
      " | card=" + (p.card ? p.card.name + " " + p.card.number + " (" + (p.card.set?.name ?? "-") + ")" : "-"));
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
