/**
 * Slår ihop en auto-importerad DUBBLETTSTUB med den riktiga katalogprodukten.
 *
 * PROBLEMET (verkligt fall 2026-07-13): restock-/feed-först-importen skapade
 *   "Pokémon, Mega Evolutions, ME04: Chaos Rising, Display / Booster Box"  (Samlarhobbys frasering)
 * trots att katalogen redan hade
 *   "Pokémon TCG: Chaos Rising Booster Box"  (setId, Cardmarket-graf, 9 butikslänkar)
 * Två sidor för exakt samma vara.
 *
 * VAD "MERGA" BETYDER HÄR (användarens definition, och den enda rimliga):
 *   BEHÅLL den KOMPLETTA produkten (setId, prisgraf, flest butikslänkar).
 *   FLYTTA ÖVER de butikslänkar den SAKNAR från stubben (t.ex. Samlarhobby).
 *   Har båda samma butik → behåll den kompletta produktens (Tradera fanns på båda).
 *   Flytta även bevakningar/samlingsposter. RADERA sedan stubben.
 * Ingen data går förlorad, och användaren landar alltid på sidan med prisgrafen.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-stub-into-canonical.ts            # dry-run, listar alla
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-stub-into-canonical.ts --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-stub-into-canonical.ts --apply --id <stubId>
 */
import { PrismaClient } from "@prisma/client";
import { mergeStubInto } from "../src/jobs/dedupe-stubs";
import { matchProduct, cleanListingTitle, loadMatchIndex, mergeEquivalent } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ONLY = (() => {
  const i = process.argv.indexOf("--id");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/** Auto-importens stubbar: inget set, inget kort — bara en butikstitel. */
const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER"] as const;

async function main() {
  console.log(APPLY ? "APPLY — skriver.\n" : "DRY-RUN — inget skrivs. Kör med --apply.\n");

  const stubs = await prisma.product.findMany({
    where: {
      setId: null, // <- kännetecknet: auto-importen sätter aldrig setId
      cardId: null,
      category: { in: [...SEALED] },
      ...(ONLY ? { id: ONLY } : {}),
    },
    select: {
      id: true, title: true, createdAt: true,
      offers: { select: { retailer: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`${stubs.length} stubbar utan setId (auto-importens signatur).\n`);
  const index = await loadMatchIndex();

  let merged = 0;
  let skipped = 0;

  for (const stub of stubs) {
    const clean = cleanListingTitle(stub.title);
    // STUBBEN MÅSTE UT UR INDEXET. Annars matchar den SIG SJÄLV med konfidens 1,000
    // (exakt normalizedTitle-träff) och den riktiga produkten övervägs aldrig — matchProduct
    // returnerar bara BÄSTA kandidaten. Kostar en filtrering per stub; katalogen är i minnet.
    const others = index.filter((c) => c.id !== stub.id);
    // rawTitle MÅSTE skickas med: utan den kör guards som behöver skiljetecken/versaler
    // (blister-underform, antal enheter, set-kod, kortsuffix) blint på den normaliserade
    // titeln. matchProduct:s egen docstring säger åt anropare att alltid skicka den.
    const match = await matchProduct(normalizeTitle(clean), others, clean);
    if (!match) {
      skipped++;
      continue;
    }

    const canonical = await prisma.product.findUnique({
      where: { id: match.productId },
      select: {
        id: true, title: true, setId: true, gtin: true,
        offers: { select: { retailer: { select: { name: true } } } },
      },
    });
    // Merga BARA in i en RIKARE produkt. Annars kunde vi råka radera den kompletta
    // sidan och behålla butiksstubben — precis tvärtom mot vad vi vill.
    if (!canonical || canonical.id === stub.id) { skipped++; continue; }
    const richer = canonical.setId !== null || canonical.offers.length > stub.offers.length;
    if (!richer) { skipped++; continue; }

    // ── DEN STRIKTA MERGE-REGELN ────────────────────────────────────────────────
    // matchProduct räcker INTE som grund för att RADERA en produkt. Dess tröskel är
    // avsiktligt generös eftersom en falskt blockerad LÄNK är osynlig — men en falsk
    // MERGE raderar en riktig produkt med pris och bevakningar. Därför krävs dessutom
    // mergeEquivalent: samma ordmängd efter att era-namn, set-koder och fyllnadsord
    // rensats och synonymer (display=box) normaliserats.
    //
    // Den här raden är skillnaden mellan att merga användarens Chaos Rising-dubblett och
    // att radera "Charizard ex Premium Collection" för att "Charizard EX Box" liknade den.
    if (!mergeEquivalent(clean, canonical.title)) {
      skipped++;
      continue;
    }
    const how =
      match.confidence >= 0.85 ? "Dice ≥ 0.85 + ordmängd" : "identisk ordmängd";

    const stubStores = stub.offers.map((o) => o.retailer.name);
    const canonStores = new Set(canonical.offers.map((o) => o.retailer.name));
    const moving = stubStores.filter((s) => !canonStores.has(s));
    const dropping = stubStores.filter((s) => canonStores.has(s));

    console.log(`⇄ "${stub.title}"`);
    console.log(`   → BEHÅLLER "${canonical.title}"  (${canonical.offers.length} butiker${canonical.setId ? ", set-märkt" : ""})`);
    console.log(`     konfidens ${match.confidence.toFixed(3)}  (${how})`);
    if (moving.length) console.log(`     FLYTTAR ÖVER butikslänk: ${moving.join(", ")}`);
    if (dropping.length) console.log(`     redan täckt (behåller den kompletta produktens): ${dropping.join(", ")}`);

    if (APPLY) {
      // mergeStubInto flyttar offers/bevakningar/samlingsposter, tar bort dubbletter
      // per (produkt, butik, skick, språk), och raderar sedan stubben.
      await mergeStubInto(stub.id, canonical.id, () => {});
    }
    merged++;
  }

  console.log(`\n${merged} stubbar ${APPLY ? "mergade" : "skulle mergas"} · ${skipped} lämnade (ingen rikare match).`);
  if (APPLY && merged > 0) {
    await recomputeProductPriceCache();
    console.log("Prisscachen omräknad.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
