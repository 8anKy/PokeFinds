/**
 * Lägger till Near Mint-villkorsfiltret (&minCondition=2) på ALLA befintliga
 * Cardmarket-singel-länkar som redan är engelsk-förfiltrerade (language=1).
 * Sealed rörs inte (sealed har inget skick). Idempotent.
 *
 * Dry run:  npx tsx scripts/cardmarket-add-nm-filter.ts
 * Skriv:    APPLY=1 npx tsx scripts/cardmarket-add-nm-filter.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

const COND = `
    o."productId" = p.id
    AND o."retailerId" = r.id
    AND r.name = 'Cardmarket'
    AND p.category = 'SINGLE_CARD'
    AND lower(o.url) LIKE '%cardmarket.com%'
    AND lower(o.url) LIKE '%language=1%'
    AND lower(o.url) NOT LIKE '%mincondition%'
`;

async function main() {
  const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM "Offer" o, "Product" p, "Retailer" r WHERE ${COND}`
  );
  console.log(`Singel-CM-länkar utan NM-filter (language=1): ${count}`);

  if (!APPLY) {
    console.log("(dry run — kör med APPLY=1 för att lägga på &minCondition=2)");
    return;
  }
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Offer" o SET url = o.url || '&minCondition=2', "updatedAt" = now() FROM "Product" p, "Retailer" r WHERE ${COND}`
  );
  console.log(`✓ La på &minCondition=2 på ${updated} länkar`);
}

main().finally(() => prisma.$disconnect());
