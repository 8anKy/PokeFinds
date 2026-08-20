/**
 * Fyller `CollectionItem.cardId` ur `Product.cardId` för poster som lagts till
 * från en produktsida eller snabbtillägget.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-collectionitem-card-id.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/backfill-collectionitem-card-id.ts --apply  # skriver
 *
 * VARFÖR: `product-actions.tsx` och `collection-quick-add.tsx` postar bara
 * `productId`. Set-kompletteringen (`services/set-completion.ts`) filtrerar på
 * `card: { setId }` och veckobrevet joinar `Card` — en post utan `cardId` räknas
 * alltså inte alls. Mätt 2026-08-20 i prod: 196 poster hos 12 användare, dvs
 * stapeln på /sets/[id] visade för lågt för dem. Nya poster löses i
 * `addCollectionItem`; det här skriptet lagar historiken.
 *
 * ⛔ Rör ALDRIG sealed: en produkt utan `cardId` (ETB, display) är inget kort i
 * setet och ska förbli kortlös.
 * ⛔ Ingen unik nyckel finns på CollectionItem, så ifyllningen kan inte krocka.
 * Lots slås inte ihop av detta — `lotKey` bär både id, skick, språk och pris.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

async function main() {
  const rows = await prisma.collectionItem.findMany({
    where: { cardId: null, productId: { not: null }, product: { cardId: { not: null } } },
    select: {
      id: true,
      userId: true,
      product: { select: { title: true, cardId: true, variantLabel: true } },
    },
  });

  console.log(`${rows.length} poster saknar cardId men pekar på en singelprodukt.`);
  const users = new Set(rows.map((r) => r.userId));
  console.log(`Berör ${users.size} användare.\n`);
  for (const r of rows.slice(0, 25))
    console.log(`  ${r.id}  →  ${r.product!.cardId}  ${r.product!.title}${r.product!.variantLabel ? ` [${r.product!.variantLabel}]` : ""}`);
  if (rows.length > 25) console.log(`  … och ${rows.length - 25} till`);

  if (!APPLY) {
    console.log("\nTORRKÖRNING — inget skrevs. Kör om med --apply.");
    return;
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // En sats per ~500 rader, inte en UPDATE per rad: Neons nota är vaken tid.
    written += await prisma.$executeRaw`
      UPDATE "CollectionItem" AS ci
         SET "cardId" = v.card_id
        FROM (VALUES ${Prisma.join(
          chunk.map((r) => Prisma.sql`(${r.id}, ${r.product!.cardId!})`)
        )}) AS v(item_id, card_id)
       WHERE ci.id = v.item_id AND ci."cardId" IS NULL`;
  }
  console.log(`\n${written} poster fick cardId.`);

  const left = await prisma.collectionItem.count({
    where: { cardId: null, productId: { not: null }, product: { cardId: { not: null } } },
  });
  console.log(`Kvar utan cardId (singelprodukter): ${left}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
