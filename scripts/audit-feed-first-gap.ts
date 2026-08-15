/**
 * VAD ÄR DET VI INTE IMPORTERAR? — bryter ner gapet "importabel annons utan Offer".
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-feed-first-gap.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-feed-first-gap.ts --store=Speltrollet --list=40
 *
 * BAKGRUND: audit-store-catalog-coverage.ts visade ~1 100 annonser som passerar hela
 * vaktkedjan men saknar Offer. Feed-först-grenen i runRestockScan grindar på
 * SEALED_FEED_CATEGORIES = {BOOSTER_BOX, BOOSTER_PACK, ETB, BUNDLE, COLLECTION_BOX,
 * TIN, BLISTER} — `OTHER` är INTE med, medan lib/product-category.isSealedCategory
 * (som restock-BEVAKNINGEN använder) räknar OTHER som sealed med flit.
 *
 * Adapterns `guessCategory` är ordbaserad, så varje sealed-form den inte känner igen
 * ("Build & Battle", "Battle Deck", "Trainer Toolkit", "Special Collection", …) blir
 * OTHER och hoppas alltså över av den ENDA kodväg som SKAPAR produkter. Kommentaren
 * vid konstanten påstår att daglig scrape-all täcker dem — men scrape-all matchar bara
 * mot BEFINTLIGA katalogprodukter, den skapar inga. Finns produkten inte får den aldrig
 * en offer, aldrig en rutt, och kan aldrig larma.
 *
 * Den här rapporten mäter hur stort det hålet är, per butik och kategori, och listar
 * titlarna så de går att bedöma för hand innan något släpps in.
 *
 * ⛔ RAPPORT ONLY.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { runRestockScan, type RestockSourceInfo } from "../src/scrapers/runner";
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
import { isDeniedListingUrl, setDynamicDenylist } from "../src/scrapers/import-denylist";
import { normalizeTitle } from "../src/lib/utils";
import { isSealedCategory } from "../src/lib/product-category";

const onlyStore = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const listN = Number(process.argv.find((a) => a.startsWith("--list="))?.slice("--list=".length) ?? 0);

/** Samma kategorimängd som feed-först-grenen grindar på (runner.ts). */
const SEALED_FEED_CATEGORIES = new Set([
  "BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER",
]);

/**
 * HELA kedjan ur ensureListingProduct, inklusive de TVÅ vakter som står SIST och bara
 * gäller SKAPANDET: positiv Pokémon-evidens och karaktärslös blister/mini tin.
 * Utan dem räknar rapporten in Kanto Vaults Disney/Marvel/Pixar-boosterboxar som
 * "saknade Pokémon-produkter" — de avvisas helt korrekt av evidensvakten.
 */
function passesGuards(
  title: string,
  url: string,
  category: string | null,
  setNames: ReadonlySet<string>
): boolean {
  if (!category) return false;
  if (!isSealedCategory(category)) return false;
  if (isBlockedListingLanguage(title, url)) return false;
  if (isDeniedListingUrl(url)) return false;
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

/** Samma normalisering som runner.ts knownSetNames(). */
async function loadSetNames(): Promise<Set<string>> {
  const rows = await prisma.cardSet.findMany({ select: { name: true } });
  const out = new Set<string>();
  for (const r of rows) {
    for (const variant of [r.name, r.name.replace(/\(.*?\)/g, " ")]) {
      const n = normalizeTitle(variant);
      if (n.length >= 3) out.add(n);
    }
  }
  return out;
}

async function main() {
  const active = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const sources: RestockSourceInfo[] = active
    .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
    .filter((s) => !onlyStore || s.name === onlyStore)
    .map((s) => ({
      name: s.name,
      type: s.type,
      baseUrl: s.baseUrl,
      rotatingFeed: (s.config as { rotatingFeed?: boolean } | null)?.rotatingFeed === true,
    }));

  const denied = await prisma.deniedListingUrl.findMany({ select: { url: true } }).catch(() => []);
  setDynamicDenylist(denied.map((d) => d.url));
  const setNames = await loadSetNames();

  const retailers = await prisma.retailer.findMany({
    where: { name: { in: sources.map((s) => s.name) } },
    select: { id: true, name: true },
  });
  const idByName = new Map(retailers.map((r) => [r.name, r.id]));

  // Alla befintliga offer-URL:er per butik (nyckel = butik+url, samma som runnern).
  const offers = await prisma.offer.findMany({
    where: { retailerId: { in: retailers.map((r) => r.id) } },
    select: { url: true, retailerId: true },
  });
  const haveOffer = new Set(offers.map((o) => `${o.retailerId}\t${o.url}`));

  console.log(`[gap] hämtar feed för ${sources.length} butiker...\n`);

  type Row = { store: string; title: string; url: string; category: string; inStock: boolean };
  const missing: Row[] = [];

  await runRestockScan({
    sources,
    shouldProcess: async (fetched) => {
      for (const f of fetched) {
        const retailerId = idByName.get(f.sourceName);
        if (!retailerId) continue;
        for (const it of f.items) {
          if (haveOffer.has(`${retailerId}\t${it.url}`)) continue;
          if (!passesGuards(it.title, it.url, it.category ?? null, setNames)) continue;
          missing.push({
            store: f.sourceName,
            title: it.title,
            url: it.url,
            category: it.category ?? "(null)",
            inStock: it.stockStatus === "IN_STOCK",
          });
        }
      }
      return false;
    },
  });

  // ---- Sammanfattning: hur mycket av gapet är just OTHER-grinden? ----
  const byCategory = new Map<string, number>();
  for (const m of missing) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);

  const blockedByFeedGate = missing.filter((m) => !SEALED_FEED_CATEGORIES.has(m.category));
  console.log(`=== ${missing.length} annonser passerar vaktkedjan men har ingen Offer ===`);
  console.log(
    `    varav ${blockedByFeedGate.length} stoppas av feed-först-grinden ` +
      `(kategori utanför SEALED_FEED_CATEGORIES) — de kan ALDRIG skapas.\n`
  );

  console.log("=== PER KATEGORI ===");
  for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    const gated = SEALED_FEED_CATEGORIES.has(cat) ? "" : "   ⛔ STOPPAS AV GRINDEN";
    console.log(`  ${String(n).padStart(5)}  ${cat}${gated}`);
  }

  console.log("\n=== PER BUTIK (saknade / varav grindade / varav i lager just nu) ===");
  const byStore = new Map<string, { total: number; gated: number; inStock: number }>();
  for (const m of missing) {
    const s = byStore.get(m.store) ?? { total: 0, gated: 0, inStock: 0 };
    s.total++;
    if (!SEALED_FEED_CATEGORIES.has(m.category)) s.gated++;
    if (m.inStock) s.inStock++;
    byStore.set(m.store, s);
  }
  for (const [store, s] of [...byStore].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${String(s.total).padStart(5)} / ${String(s.gated).padStart(5)} / ${String(s.inStock).padStart(5)}   ${store}`
    );
  }

  if (listN > 0) {
    console.log(`\n=== EXEMPEL PÅ GRINDADE (kategori OTHER m.fl.), ${listN} st ===`);
    for (const m of blockedByFeedGate.slice(0, listN)) {
      console.log(`  [${m.category}] ${m.store}: ${m.title}`);
      console.log(`        ${m.url}`);
    }
    console.log(`\n=== EXEMPEL PÅ ICKE-GRINDADE SOM ÄNDÅ SAKNAR OFFER, ${listN} st ===`);
    for (const m of missing.filter((x) => SEALED_FEED_CATEGORIES.has(x.category)).slice(0, listN)) {
      console.log(`  [${m.category}] ${m.store}: ${m.title}`);
      console.log(`        ${m.url}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
