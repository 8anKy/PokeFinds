/**
 * Konverterar Cardmarket-offers som fortfarande pekar på en SÖK-länk
 * (searchString=...) till en exakt engelsk produktlänk: cachad CM-slug
 * (?language=1) om den finns, annars prices.pokemontcg.io/cardmarket/{id}
 * (redirecten döljs i UI tills resolve-cm-urls.ts uppgraderat den till slug).
 *
 * Bakgrund: vi visar bara offers med direkt engelsk produktlänk. Singlar vars
 * kort har ett Pokémon TCG-API-id (tcgExternalId) kan få en exakt CM-länk.
 * Produkter utan tcgExternalId lämnas orörda (deras sök-offer döljs i UI).
 *
 * Körs med:  npx tsx scripts/fix-cm-search-offers.ts        (dry-run)
 *            APPLY=1 npx tsx scripts/fix-cm-search-offers.ts (skriv)
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { cardmarketExactUrl } from "./marketplace-urls";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

/** Cachade exakta engelska CM-slug-länkar (resolve-cm-urls.ts), tcgId → url. */
const slugCache: Record<string, string> = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), ".cache", "cm-resolved-urls.json"), "utf8")
    );
  } catch {
    return {};
  }
})();

async function main() {
  const retailer = await prisma.retailer.findFirst({
    where: { name: "Cardmarket" },
    select: { id: true },
  });
  if (!retailer) throw new Error("Cardmarket-retailer saknas");

  // Alla CM-offers vars URL är en sök-länk.
  const offers = await prisma.offer.findMany({
    where: {
      retailerId: retailer.id,
      OR: [
        { url: { contains: "search", mode: "insensitive" } },
        { url: { contains: "?q=" } },
      ],
    },
    select: {
      id: true,
      url: true,
      product: { select: { card: { select: { tcgExternalId: true } } } },
    },
  });

  let fixable = 0;
  let skipped = 0;
  const updates: { id: string; url: string }[] = [];

  for (const o of offers) {
    const tid = o.product.card?.tcgExternalId;
    if (!tid) {
      skipped++;
      continue;
    }
    const direct = slugCache[tid] ?? cardmarketExactUrl(tid);
    if (direct === o.url) continue;
    fixable++;
    updates.push({ id: o.id, url: direct });
  }

  console.log(`CM sök-offers totalt:        ${offers.length}`);
  console.log(`→ kan göras direkta:         ${fixable}`);
  console.log(`→ saknar tcgExternalId:      ${skipped} (lämnas, döljs i UI)`);

  if (!APPLY) {
    console.log("\nDry-run. Kör med APPLY=1 för att skriva.");
    return;
  }

  let done = 0;
  for (const u of updates) {
    await prisma.offer.update({ where: { id: u.id }, data: { url: u.url } });
    done++;
    if (done % 100 === 0) console.log(`  uppdaterade ${done}/${updates.length}`);
  }
  console.log(`\nKlart: ${done} offers fick direkt CM-länk.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
