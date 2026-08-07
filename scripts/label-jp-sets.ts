/**
 * Skapar japanska CardSet ur Cardmarkets expansioner och etiketterar JP-produkterna.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/label-jp-sets.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/label-jp-sets.ts --apply
 *
 * TORRKÖRNING ÄR DEFAULT. Samma kod som kör dagligen i `runJapaneseSealedRefresh`
 * — skriptet finns för engångsbackfillen och för att kunna GRANSKA namnen innan
 * de skapas. Kostar ingen RapidAPI-kvot: CM:s katalog är en publik fil och TCGdex
 * är gratis (och frågas bara när ett set faktiskt skapas).
 */
import { prisma } from "../src/lib/db";
import { runJapaneseSetLabels, type JpCatalogRow } from "../src/jobs/jp-set-label";

const NON_SINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";

const APPLY = process.argv.includes("--apply");

async function main() {
  const res = await fetch(NON_SINGLES_URL);
  if (!res.ok) {
    console.error(`Cardmarkets sealed-katalog svarade ${res.status} — avbryter (ingen gissning).`);
    process.exit(1);
  }
  const catalog = ((await res.json()) as { products: JpCatalogRow[] }).products;
  console.log(`Cardmarket-katalog: ${catalog.length} sealed-produkter.`);
  console.log(APPLY ? "LÄGE: SKRIVER" : "LÄGE: torrkörning (lägg till --apply för att skriva)");

  const out = await runJapaneseSetLabels(catalog, APPLY);
  console.log(
    `\nKandidater (JP utan set): ${out.candidates}\n` +
      `Etiketterade: ${out.labeled}\n` +
      `Nya set: ${out.setsCreated}\n` +
      `Utan CM-koppling (ingen expansion): ${out.noCmLink}\n` +
      `Expansioner utan härledbart namn: ${out.unnamed}\n` +
      `Set som fick serie/bild ifylld: ${out.metadataFilled}`
  );
  if (out.createdNames.length) console.log(`\nSet:\n  ${out.createdNames.join("\n  ")}`);
}

main().finally(() => prisma.$disconnect());
