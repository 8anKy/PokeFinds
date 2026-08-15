/**
 * OFFLINE-ANALYS av en feed-dump (scripts/dump-store-feeds.ts) — vilka annonser blir
 * `OTHER` fast de är riktiga sealed-SKU:er?
 *
 *   npx tsx scripts/analyze-feed-categories.ts <feeds.json> [--all] [--reclass]
 *
 * `OTHER` är med i HIDDEN_CATEGORIES, så en produkt som hamnar där är osynlig i
 * katalogen OCH tyst i restock-larmen (runner.ts hoppar över gömda kategorier), och
 * feed-först-grenen skapar den aldrig. Klassificeringen är alltså inte en etikett —
 * den avgör om varan existerar för oss.
 *
 * ⛔ RÖR VARKEN NÄT ELLER DB. Läser bara dumpen.
 */
import { readFileSync } from "node:fs";
import {
  classifyForm,
  cleanListingTitle,
  isAccessoryListing,
  isStoreBundleListing,
  isOtherFranchiseListing,
  isMerchandiseListing,
  isSingleCardListing,
  isUnspecifiedCharacterListing,
  hasPokemonTitleSignal,
} from "../src/scrapers/matching";
import { isBlockedListingLanguage } from "../src/lib/listing-language";
import { normalizeTitle } from "../src/lib/utils";
import { isSealedCategory } from "../src/lib/product-category";
import { guessListingCategory } from "../src/scrapers/listing-category";

const file = process.argv[2];
const showAll = process.argv.includes("--all");
const reclass = process.argv.includes("--reclass");

interface Dump {
  groups: { sourceName: string; items: { url: string; title: string; category: string | null; stockStatus: string }[] }[];
  offerUrls: string[];
  denied: string[];
  setNames: string[];
}

const dump = JSON.parse(readFileSync(file, "utf8")) as Dump;
const haveOffer = new Set(dump.offerUrls);
const setNames = new Set<string>();
for (const name of dump.setNames) {
  for (const variant of [name, name.replace(/\(.*?\)/g, " ")]) {
    const n = normalizeTitle(variant);
    if (n.length >= 3) setNames.add(n);
  }
}
const deniedNorm = new Set(dump.denied);

/** Vaktkedjan UTAN kategorigrinden — "är det här en Pokémon-sealed-vara vi vill ha?" */
function wantedProduct(title: string, url: string): boolean {
  if (isBlockedListingLanguage(title, url)) return false;
  if (deniedNorm.has(url)) return false;
  const clean = cleanListingTitle(title);
  const form = classifyForm(normalizeTitle(clean));
  if (form === "multipack" || form === "case" || form === "combo" || form === "event") return false;
  if (isAccessoryListing(clean)) return false;
  if (isStoreBundleListing(clean)) return false;
  if (isOtherFranchiseListing(clean)) return false;
  if (isSingleCardListing(clean)) return false;
  if (isMerchandiseListing(clean)) return false;
  if (!hasPokemonTitleSignal(clean, setNames)) return false;
  if (isUnspecifiedCharacterListing(clean)) return false;
  return true;
}

const SEALED_FEED_CATEGORIES = new Set([
  "BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER",
]);

type Row = { store: string; title: string; url: string; category: string; wanted: boolean; hasOffer: boolean };
const rows: Row[] = [];
for (const g of dump.groups) {
  for (const it of g.items) {
    rows.push({
      store: g.sourceName,
      title: it.title,
      url: it.url,
      category: it.category ?? "(null)",
      wanted: isSealedCategory(it.category) && wantedProduct(it.title, it.url),
      hasOffer: haveOffer.has(`${g.sourceName}\t${it.url}`),
    });
  }
}

const blocked = rows.filter((r) => r.wanted && !r.hasOffer && !SEALED_FEED_CATEGORIES.has(r.category));
console.log(`Dumpen: ${rows.length} annonser, ${rows.filter((r) => r.wanted).length} önskade Pokémon-sealed.`);
console.log(`GRINDADE (önskade, ingen offer, kategori utanför grinden): ${blocked.length}\n`);

if (reclass) {
  // Vad skulle den NYA klassificeraren göra med dem?
  const fixed = blocked.filter((r) => SEALED_FEED_CATEGORIES.has(guessListingCategory(r.title)));
  const still = blocked.filter((r) => !SEALED_FEED_CATEGORIES.has(guessListingCategory(r.title)));
  console.log(`=== NY KLASSIFICERARE: ${fixed.length} räddas, ${still.length} kvar som OTHER ===\n`);
  const byNew = new Map<string, Row[]>();
  for (const r of fixed) {
    const c = guessListingCategory(r.title);
    byNew.set(c, [...(byNew.get(c) ?? []), r]);
  }
  for (const [cat, list] of [...byNew].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- ${cat}: ${list.length} ---`);
    for (const r of list.slice(0, showAll ? list.length : 12)) console.log(`    ${r.store}: ${r.title}`);
  }
  console.log(`\n=== KVAR SOM OTHER (${still.length}) ===`);
  for (const r of still.slice(0, showAll ? still.length : 60)) console.log(`    ${r.store}: ${r.title}`);

  // ⛔ REGRESSIONSMÄTNING: ändrar den nya klassificeraren något för annonser som
  // REDAN har en offer? En omklassning där byter produktens synlighet/kategori.
  const changed = rows.filter(
    (r) => r.hasOffer && guessListingCategory(r.title) !== r.category
  );
  console.log(`\n=== OMKLASSNING AV BEFINTLIGA ANNONSER: ${changed.length} av ${rows.filter((r) => r.hasOffer).length} ===`);
  const pairs = new Map<string, number>();
  for (const r of changed) {
    const k = `${r.category} → ${guessListingCategory(r.title)}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${k}`);
  if (showAll) {
    for (const r of changed) console.log(`      [${r.category}→${guessListingCategory(r.title)}] ${r.store}: ${r.title}`);
  }
} else {
  for (const r of blocked.slice(0, showAll ? blocked.length : 120)) {
    console.log(`  ${r.store}: ${r.title}`);
  }
}
