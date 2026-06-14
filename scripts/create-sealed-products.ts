/**
 * Skapar sealed-produkter (Booster Pack, Booster Box, Elite Trainer Box) för
 * alla huvudset som saknar dem, så att set+kategori-filtret alltid har data.
 *
 * - Promo-/specialset (promos, McDonald's, Trainer Kits, Energies, POP m.fl.)
 *   hoppas över — de har inga boosters i handeln.
 * - ETB skapas endast för set släppta efter att Elite Trainer Box introducerades
 *   (hösten 2013).
 * - Produkterna får INGA fabricerade priser — offers (Cardmarket/Tradera-länkar)
 *   läggs av scripts/backfill-marketplace-offers.ts.
 *
 * Körs med: npx tsx scripts/create-sealed-products.ts
 */
import { PrismaClient, ProductCategory } from "@prisma/client";
import { normalizeTitle, slugify } from "../src/lib/utils";

const prisma = new PrismaClient();

/** Set utan boosters i handeln. */
const SKIP_NAME = /promo|mcdonald|trainer kit|energies|classic collection|^pop\b|futsal|best of/i;

const ETB_INTRODUCED = new Date("2013-10-01");

const SEALED_KINDS: { category: ProductCategory; label: string; minDate?: Date }[] = [
  { category: "BOOSTER_PACK", label: "Booster Pack" },
  { category: "BOOSTER_BOX", label: "Booster Box" },
  { category: "ETB", label: "Elite Trainer Box", minDate: ETB_INTRODUCED },
];

async function main() {
  const sets = await prisma.cardSet.findMany({
    select: {
      id: true,
      externalId: true,
      name: true,
      releaseDate: true,
      logoUrl: true,
      products: {
        where: { category: { not: "SINGLE_CARD" } },
        select: { category: true },
      },
    },
  });

  let created = 0;
  let skippedSets = 0;

  for (const set of sets) {
    if (SKIP_NAME.test(set.name)) {
      skippedSets++;
      continue;
    }
    const existing = new Set(set.products.map((p) => p.category));

    for (const kind of SEALED_KINDS) {
      if (existing.has(kind.category)) continue;
      if (kind.minDate && (!set.releaseDate || set.releaseDate < kind.minDate)) continue;

      const title = `${set.name} ${kind.label}`;
      const slug = slugify(`${set.name}-${set.externalId ?? set.id}-${kind.label}`);
      await prisma.product.upsert({
        where: { slug },
        update: {},
        create: {
          title,
          normalizedTitle: normalizeTitle(title),
          slug,
          category: kind.category,
          setId: set.id,
          imageUrl: set.logoUrl,
          language: "EN",
        },
      });
      created++;
    }
  }

  console.log(`🎉 Klart! ${created} sealed-produkter skapade (${skippedSets} promo-/specialset hoppade).`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
