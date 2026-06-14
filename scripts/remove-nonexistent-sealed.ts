/**
 * Tar bort sealed-produkter som inte existerar som riktiga produkter:
 * skapade av tidigare generationsscript (t.ex. "Trainer Gallery Booster Box",
 * "Crown Zenith Booster Box") men som
 *   1) inte matchar någon produkt i Cardmarkets officiella katalog,
 *   2) saknar prissatta offers (inga riktiga butiks-/marknadspriser),
 *   3) saknar prisobservationer.
 *
 * Produkter med riktiga skrapade priser behålls alltid (de finns bevisligen
 * till salu, t.ex. kinesiska Gem Packs på Tradera).
 *
 * Kör: DRY_RUN=1 npx tsx scripts/remove-nonexistent-sealed.ts  (rapport)
 *      npx tsx scripts/remove-nonexistent-sealed.ts            (raderar)
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  // Produkter som matchade CM-katalogen är verkliga — rör dem inte även om pris saknas
  const matchedFile = path.join(__dirname, "..", ".cache", "cardmarket", "matched-products.json");
  const cmMatched = new Set<string>(
    fs.existsSync(matchedFile)
      ? (JSON.parse(fs.readFileSync(matchedFile, "utf8")).matched as { productId: string }[]).map((m) => m.productId)
      : []
  );
  console.log(`${cmMatched.size} produkter skyddade via CM-katalogmatchning`);

  const candidates = await prisma.product.findMany({
    where: {
      category: { in: ["BOOSTER_PACK", "BOOSTER_BOX", "ETB", "BUNDLE", "BLISTER", "COLLECTION_BOX", "TIN"] },
      offers: { none: { price: { not: null } } },
      priceObservations: { none: {} },
    },
    select: {
      id: true,
      title: true,
      category: true,
      _count: { select: { watchlistItems: true, collectionItems: true } },
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  const toDelete = candidates.filter((p) => !cmMatched.has(p.id));
  console.log(`${toDelete.length} sealed-produkter utan pris/observation (existerar ej enligt CM-katalogen):\n`);
  for (const p of toDelete) {
    const refs = p._count.watchlistItems + p._count.collectionItems;
    console.log(`  ${DRY_RUN ? "[dry]" : "DEL"} ${p.category} | ${p.title}${refs > 0 ? ` (⚠ ${refs} användarreferenser)` : ""}`);
    if (!DRY_RUN) {
      await prisma.product.delete({ where: { id: p.id } });
    }
  }
  console.log(`\n${DRY_RUN ? "Skulle radera" : "Raderade"}: ${toDelete.length}`);
}

main()
  .catch((e) => {
    console.error("Misslyckades:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
