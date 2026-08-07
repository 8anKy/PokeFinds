/**
 * TORRKÖRNING av butiksadaptrar — hämtar feeden och rapporterar vad den skulle ge,
 * UTAN att röra databasen.
 *
 * Varför ett eget skript i stället för att bara köra jobbet: en ny adapter kan
 * misslyckas på fyra sätt som alla ser likadana ut i en jobblogg — plattformen svarar
 * inte, namnfiltret hittar ingen kategori, kategorin är tom, eller allt som kommer ut
 * är tillbehör/singlar. Rapporten skiljer dem åt, och gör det mot butikens RIKTIGA
 * feed i stället för mot en gissning.
 *
 *   npx tsx scripts/probe-new-adapters.ts                 # alla Wave 4-butiker
 *   npx tsx scripts/probe-new-adapters.ts "Card Club"     # en butik
 *   SHOW=1 npx tsx scripts/probe-new-adapters.ts          # visa exempeltitlar
 */
import { getAdapter } from "@/scrapers/runner";
import { SourceType } from "@prisma/client";
import {
  cleanListingTitle,
  classifyForm,
  isAccessoryListing,
  isStoreBundleListing,
  isOtherFranchiseListing,
  isMerchandiseListing,
  isSingleCardListing,
} from "@/scrapers/matching";
import { normalizeTitle } from "@/lib/utils";

const WAVE4 = [
  "TCG Store", "Beam Cardshop", "Hobbykort", "Pokétalk", "Kanto Vault", "Pokemurre",
  "AuroraDex", "Tiny Misters", "Cardlevels", "Kortarkivet", "RahTech", "Card Club",
  "Blindbox", "RGB Kingz", "Miniature Metropolis", "Pokexclusive", "Spelgalaxen",
  "CardGame", "Mystery Shack", "Packs on Packs",
  "Fantasia North", "The Swedish Fish", "Pocketmonsters",
];

/** Samma grindkedja som ensureListingProduct — men utan DB, så den går att mäta. */
function verdict(rawTitle: string): "sealed" | "singel" | "merch" | "tillbehör" | "bundle" | "annat spel" | "lot" {
  const t = cleanListingTitle(rawTitle);
  const form = classifyForm(normalizeTitle(t));
  if (form === "multipack" || form === "case" || form === "combo" || form === "event") return "lot";
  if (isAccessoryListing(t)) return "tillbehör";
  if (isStoreBundleListing(t)) return "bundle";
  if (isOtherFranchiseListing(t)) return "annat spel";
  if (isSingleCardListing(t)) return "singel";
  if (isMerchandiseListing(t)) return "merch";
  return "sealed";
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const stores = only.length ? only : WAVE4;
  const show = process.env.SHOW === "1";
  let totalSealed = 0;
  const failed: string[] = [];

  for (const name of stores) {
    const started = Date.now();
    try {
      const adapter = getAdapter(SourceType.SCRAPER, name);
      const { products, errors } = await adapter.fetchProducts();
      const counts = new Map<string, number>();
      const sealed: string[] = [];
      for (const p of products) {
        const v = verdict(p.title);
        counts.set(v, (counts.get(v) ?? 0) + 1);
        if (v === "sealed") sealed.push(p.title);
      }
      const inStock = products.filter((p) => p.stockStatus === "IN_STOCK").length;
      totalSealed += sealed.length;
      const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
      console.log(
        `${name.padEnd(22)} feed=${String(products.length).padEnd(5)} i lager=${String(inStock).padEnd(5)} SEALED=${String(sealed.length).padEnd(5)} ${breakdown}  (${((Date.now() - started) / 1000).toFixed(0)}s)`
      );
      if (!products.length) failed.push(`${name}: TOM FEED`);
      for (const e of errors.slice(0, 3)) console.log(`    ! ${e}`);
      if (show) for (const t of sealed.slice(0, 8)) console.log(`      · ${t}`);
      // SHOW_REJECTED=singel|merch|tillbehör … — se VAD en grind kastar. Det är enda
      // sättet att skilja "vakten fungerar" från "vakten är för bred", och en för bred
      // vakt syns aldrig i drift: den varan blir bara aldrig en produkt.
      const showRejected = process.env.SHOW_REJECTED;
      if (showRejected) {
        const rejected = products.filter((p) => verdict(p.title) === showRejected);
        for (const p of rejected.slice(0, 25)) console.log(`      ✗ ${p.title}`);
      }
    } catch (err) {
      failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`${name.padEnd(22)} FEL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nTotalt sealed-annonser: ${totalSealed}`);
  if (failed.length) {
    console.log(`\nBUTIKER SOM INTE GAV NÅGOT (${failed.length}):`);
    for (const f of failed) console.log(`  - ${f}`);
  }
}

main();
