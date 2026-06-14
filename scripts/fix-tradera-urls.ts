/**
 * Förbättrar Tradera sök-URL:er med:
 *  1. Kategorifilter (categoryId) — singlar, boxar, paket osv.
 *  2. Mer specifika söktermer — kortnamn + set-namn + nummer för singlar.
 *
 * Rör INTE riktiga skrapade Tradera-offers (som pekar på /item/).
 *
 * Körs med: npx tsx scripts/fix-tradera-urls.ts
 */
import { PrismaClient } from "@prisma/client";
import { traderaSearchUrlSpecific } from "../src/lib/marketplace-urls";

const prisma = new PrismaClient();
const BATCH = 500;

/** Bygg specifik sökterm baserat på produkttyp. */
function buildSearchTerm(product: {
  title: string;
  category: string;
  card: { name: string; number: string; set: { name: string } } | null;
}): string {
  if (product.card) {
    // Singelkort: "Charizard ex Obsidian Flames 125"
    const { name, number, set } = product.card;
    // Ta bara set-namnet utan "Pokémon TCG:" prefix om det finns
    const setName = set.name.replace(/^Pokémon\s+TCG:\s*/i, "").trim();
    return `${name} ${setName} ${number}`;
  }
  // Sealed/övrigt: använd produkttiteln utan interpunkt
  return product.title.replace(/\s*·\s*/g, " ").trim();
}

async function main() {
  const tradera = await prisma.retailer.findFirstOrThrow({
    where: { name: "Tradera" },
  });

  let updated = 0;
  let skipped = 0;
  let cursor: string | undefined;

  while (true) {
    const offers = await prisma.offer.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      where: {
        retailerId: tradera.id,
        url: { contains: "tradera.com/search" }, // Bara sök-URL:er
      },
      select: {
        id: true,
        url: true,
        product: {
          select: {
            title: true,
            category: true,
            card: {
              select: {
                name: true,
                number: true,
                set: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (offers.length === 0) break;
    cursor = offers[offers.length - 1].id;

    for (const o of offers) {
      const term = buildSearchTerm(o.product);
      const newUrl = traderaSearchUrlSpecific(term, o.product.category);

      if (o.url === newUrl) {
        skipped++;
        continue;
      }

      await prisma.offer.update({
        where: { id: o.id },
        data: { url: newUrl },
      });
      updated++;
    }

    const total = updated + skipped;
    if (total % 1000 === 0 || offers.length < BATCH) {
      console.log(`  ✅ ${updated} uppdaterade | ⏭️ ${skipped} redan korrekta`);
    }
  }

  console.log("\n🎉 Klart!");
  console.log(`   Uppdaterade Tradera-URL:er: ${updated}`);
  console.log(`   Redan korrekta: ${skipped}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
