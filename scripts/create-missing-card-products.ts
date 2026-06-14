/**
 * Create Product entries for Card records that don't have corresponding products.
 * Focuses on major sets like Ascended Heroes, Chaos Rising, Perfect Order.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  // Find cards without products
  const cardsWithoutProducts = await prisma.card.findMany({
    where: {
      products: { none: {} },
    },
    include: {
      set: { select: { id: true, name: true, totalCards: true } },
    },
  });

  console.log("Cards without products:", cardsWithoutProducts.length);

  let created = 0;
  let skipped = 0;

  for (const card of cardsWithoutProducts) {
    const setName = card.set?.name ?? "";
    const number = card.number ?? "";
    const totalInSet = card.set?.totalCards || "";
    
    const title = `${card.name} · ${setName}${number ? ` ${number}` : ""}${totalInSet ? `/${totalInSet}` : ""}`;
    const baseSlug = slugify(title);
    
    // Make slug unique
    let slug = baseSlug;
    let attempt = 0;
    while (true) {
      const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
      if (!existing) break;
      attempt++;
      slug = `${baseSlug}-${attempt}`;
    }

    try {
      await prisma.product.create({
        data: {
          title,
          normalizedTitle: normalizeTitle(title),
          slug,
          category: "SINGLE_CARD",
          cardId: card.id,
          setId: card.setId,
          imageUrl: card.imageUrl ?? null,
          language: "EN",
        },
      });
      created++;
    } catch (e: unknown) {
      skipped++;
      if (created + skipped <= 5) {
        console.log("Skipped:", title.slice(0, 50), (e as Error).message?.slice(0, 60));
      }
    }
  }

  console.log("Created:", created);
  console.log("Skipped:", skipped);

  // Verify Ascended Heroes now
  const set = await prisma.cardSet.findFirst({ where: { name: "Ascended Heroes" } });
  if (set) {
    const count = await prisma.product.count({ where: { setId: set.id } });
    console.log("\nAscended Heroes products now:", count);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
