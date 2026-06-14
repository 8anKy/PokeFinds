/**
 * 1. Clean "- Tradera Såld" suffixes from product titles
 * 2. Sync SINGLE_CARD images from their linked Card (fixes wrong images)
 * 3. Try to link unlinked single cards to cards via number/set matching
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function normalizeTitle(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  // 1. Clean titles
  console.log("1. Cleaning Tradera title artifacts...");
  const artifacts = await prisma.product.findMany({
    where: {
      OR: [
        { title: { contains: "Tradera Såld", mode: "insensitive" } },
        { title: { contains: "- Tradera", mode: "insensitive" } },
        { title: { endsWith: "Såld" } },
      ],
    },
    select: { id: true, title: true },
  });
  for (const p of artifacts) {
    const clean = p.title
      .replace(/\s*-\s*Tradera\s*Såld\s*$/i, "")
      .replace(/\s*-\s*Tradera\s*$/i, "")
      .replace(/\s*Såld\s*$/i, "")
      .trim();
    if (clean !== p.title) {
      await prisma.product.update({
        where: { id: p.id },
        data: { title: clean, normalizedTitle: normalizeTitle(clean) },
      });
      console.log("   " + p.title.slice(0, 50) + " -> " + clean.slice(0, 50));
    }
  }

  // 2. Sync single-card images from Card
  console.log("\n2. Syncing single-card images from card data...");
  const mismatched = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p."id" FROM "Product" p
    JOIN "Card" c ON p."cardId" = c."id"
    WHERE p."category" = 'SINGLE_CARD'
      AND c."imageUrl" IS NOT NULL
      AND (p."imageUrl" IS NULL OR p."imageUrl" != c."imageUrl")
  `;
  console.log("   Products with image differing from card:", mismatched.length);
  if (mismatched.length > 0) {
    await prisma.$executeRaw`
      UPDATE "Product" p SET "imageUrl" = c."imageUrl"
      FROM "Card" c
      WHERE p."cardId" = c."id"
        AND p."category" = 'SINGLE_CARD'
        AND c."imageUrl" IS NOT NULL
        AND (p."imageUrl" IS NULL OR p."imageUrl" != c."imageUrl")
    `;
    console.log("   Synced.");
  }

  // 3. Link unlinked single cards via number/set match
  console.log("\n3. Linking unlinked single cards...");
  const unlinked = await prisma.product.findMany({
    where: { category: "SINGLE_CARD", cardId: null },
    select: { id: true, title: true, normalizedTitle: true },
  });
  console.log("   Unlinked single cards:", unlinked.length);
  let linked = 0;
  for (const p of unlinked) {
    // Extract number pattern like "006/165" or "6/165"
    const m = p.title.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) continue;
    const number = String(parseInt(m[1], 10));
    // Find candidate cards with this number whose name appears in the title
    const cards = await prisma.card.findMany({
      where: { number },
      select: { id: true, name: true, imageUrl: true, setId: true, set: { select: { name: true } } },
    });
    const tNorm = p.normalizedTitle;
    const match = cards.find((c) =>
      tNorm.includes(normalizeTitle(c.name)) &&
      (c.set?.name ? tNorm.includes(normalizeTitle(c.set.name).split(" ")[0]) : false)
    ) ?? cards.find((c) => tNorm.includes(normalizeTitle(c.name)));
    if (match) {
      await prisma.product.update({
        where: { id: p.id },
        data: { cardId: match.id, setId: match.setId, imageUrl: match.imageUrl ?? undefined },
      });
      linked++;
      console.log("   Linked: " + p.title.slice(0, 50) + " -> " + match.name);
    }
  }
  console.log("   Linked " + linked + "/" + unlinked.length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
