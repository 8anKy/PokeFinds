/**
 * FALSKLARMS-MÄTNING AV VAKTÄNDRINGAR — grinden för att ändra en vakt i matching.ts.
 *
 *   npx tsx scripts/measure-guard-changes.ts <feeds.json> <catalog-sealed.json> [--list]
 *
 * REGELN (etablerad 2026-08-07 för samlarnummer-tecknet, bekräftad av Webhallen-
 * misstaget 2026-08-14): en vakt får ändras först när det är MÄTT vad den fäller av
 * det vi redan har. Två facit, båda måste vara rena:
 *
 *   1. KATALOGEN — en vakt som fäller en produkt vi redan publicerar är för bred.
 *      Vakterna sitter också i `productsConflict`, där en falsk träff BLOCKERAR en
 *      korrekt butikslänk tyst.
 *   2. FEEDANNONSER SOM REDAN HAR EN OFFER — de är bevisat accepterade i dag. Fäller
 *      den nya vakten dem nollas butikens länk vid nästa körning.
 *
 * ⛔ Läser varken nät eller DB — bara de två dumparna.
 */
import { readFileSync } from "node:fs";
import {
  cleanListingTitle,
  isAccessoryListing,
  isMerchandiseListing,
  isSingleCardListing,
} from "../src/scrapers/matching";
import { isBlockedListingLanguage } from "../src/lib/listing-language";

const feedFile = process.argv[2];
const catalogFile = process.argv[3];
const list = process.argv.includes("--list");

interface Dump {
  groups: { sourceName: string; items: { url: string; title: string; category: string | null }[] }[];
  offerUrls: string[];
}
interface CatalogRow { id: string; title: string; category: string; language: string; slug: string }

const dump = JSON.parse(readFileSync(feedFile, "utf8")) as Dump;
const catalog = JSON.parse(readFileSync(catalogFile, "utf8")) as CatalogRow[];
const haveOffer = new Set(dump.offerUrls);

const GUARDS: { name: string; hit: (title: string, url: string) => boolean }[] = [
  { name: "isSingleCardListing", hit: (t) => isSingleCardListing(cleanListingTitle(t)) },
  { name: "isMerchandiseListing", hit: (t) => isMerchandiseListing(cleanListingTitle(t)) },
  { name: "isAccessoryListing", hit: (t) => isAccessoryListing(cleanListingTitle(t)) },
  { name: "isBlockedListingLanguage", hit: (t, u) => isBlockedListingLanguage(t, u) },
];

console.log(`=== FACIT 1: KATALOGEN (${catalog.length} sealed-produkter) ===`);
console.log("En träff här = en produkt vi PUBLICERAR skulle nu fällas.\n");
let catalogTotal = 0;
for (const g of GUARDS) {
  const hits = catalog.filter((p) => g.hit(p.title, `https://foilio.se/produkter/${p.slug}`));
  catalogTotal += hits.length;
  console.log(`  ${String(hits.length).padStart(5)}  ${g.name}`);
  for (const h of hits.slice(0, list ? hits.length : 15)) {
    console.log(`         [${h.category}/${h.language}] ${h.title}`);
  }
}

console.log(`\n=== FACIT 2: FEEDANNONSER SOM REDAN HAR EN OFFER ===`);
const withOffer: { store: string; title: string; url: string }[] = [];
for (const gr of dump.groups) {
  for (const it of gr.items) {
    if (haveOffer.has(`${gr.sourceName}\t${it.url}`)) {
      withOffer.push({ store: gr.sourceName, title: it.title, url: it.url });
    }
  }
}
console.log(`(${withOffer.length} annonser) — en träff = en befintlig butikslänk skulle nollas.\n`);
let feedTotal = 0;
for (const g of GUARDS) {
  const hits = withOffer.filter((r) => g.hit(r.title, r.url));
  feedTotal += hits.length;
  console.log(`  ${String(hits.length).padStart(5)}  ${g.name}`);
  for (const h of hits.slice(0, list ? hits.length : 15)) {
    console.log(`         ${h.store}: ${h.title}`);
  }
}

console.log(
  `\nSUMMA: ${catalogTotal} katalogträffar, ${feedTotal} träffar på annonser med offer.` +
    (catalogTotal + feedTotal === 0 ? "  ✅ RENT" : "  ⚠️ GRANSKA VARJE TRÄFF OVAN")
);
