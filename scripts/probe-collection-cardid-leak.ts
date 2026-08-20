/**
 * Mäter numeratorläckan: samlingsposter som pekar på en SINGEL-produkt men
 * saknar `cardId` räknas inte av set-kompletteringen (services/set-completion.ts
 * filtrerar på `card: { setId }`). Läser bara.
 */
import { prisma } from "../src/lib/db";
async function main() {
  const rows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(`
    SELECT
      COUNT(*) FILTER (WHERE ci."cardId" IS NULL AND ci."productId" IS NOT NULL AND p."cardId" IS NOT NULL) AS leak_items,
      COUNT(DISTINCT ci."userId") FILTER (WHERE ci."cardId" IS NULL AND ci."productId" IS NOT NULL AND p."cardId" IS NOT NULL) AS leak_users,
      COUNT(DISTINCT p."cardId") FILTER (WHERE ci."cardId" IS NULL AND ci."productId" IS NOT NULL AND p."cardId" IS NOT NULL) AS leak_cards,
      COUNT(*) FILTER (WHERE ci."cardId" IS NULL AND ci."productId" IS NOT NULL AND p."cardId" IS NULL) AS sealed_items,
      COUNT(*) FILTER (WHERE ci."cardId" IS NOT NULL) AS with_card,
      COUNT(*) AS total_items,
      COUNT(*) FILTER (WHERE p."variantLabel" IS NOT NULL) AS variant_items
    FROM "CollectionItem" ci LEFT JOIN "Product" p ON p.id = ci."productId"`);
  console.log(JSON.stringify(rows[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  const users = await prisma.user.count();
  console.log("users:", users);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
