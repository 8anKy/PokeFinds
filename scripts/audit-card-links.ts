/**
 * Find products whose linked card belongs to a different set than the
 * product's own set (symptom of bad number-only matching), and unlink them.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const mismatched = await prisma.product.findMany({
    where: {
      cardId: { not: null },
      setId: { not: null },
    },
    select: {
      id: true,
      title: true,
      setId: true,
      set: { select: { name: true } },
      card: { select: { id: true, name: true, setId: true, set: { select: { name: true } } } },
    },
  });

  const bad = mismatched.filter((p) => p.card && p.card.setId !== p.setId);
  console.log("Products with card from different set: " + bad.length);
  for (const p of bad) {
    console.log(
      '  "' + p.title + '" [set: ' + (p.set?.name ?? "?") + "] -> card " +
      p.card!.name + " [set: " + (p.card!.set?.name ?? "?") + "]"
    );
  }

  if (process.argv.includes("--fix")) {
    let relinked = 0;
    let unlinked = 0;
    for (const p of bad) {
      // Try to find correct card: same name in the product's set
      const correct = await prisma.card.findFirst({
        where: { setId: p.setId!, name: p.card!.name },
        select: { id: true },
      });
      if (correct) {
        await prisma.product.update({ where: { id: p.id }, data: { cardId: correct.id } });
        relinked++;
        console.log("  RELINKED: " + p.title);
      } else {
        await prisma.product.update({ where: { id: p.id }, data: { cardId: null } });
        unlinked++;
        console.log("  UNLINKED: " + p.title);
      }
    }
    console.log("Relinked: " + relinked + ", unlinked: " + unlinked);
  } else {
    console.log("\nRun with --fix to repair.");
  }
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
