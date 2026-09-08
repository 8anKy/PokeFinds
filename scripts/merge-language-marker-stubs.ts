/**
 * Mergar de dubbletter som SPRÅKVAKTEN själv skapade (2026-09-08).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-language-marker-stubs.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/merge-language-marker-stubs.ts --apply   # skriver
 *
 * BAKGRUND: `languageMismatch` läste språket ur TITELN, och "EN" är detektorns
 * FALLBACK — inte ett bevis. Katalogens japanska sealed bär Cardmarkets adopterade
 * namn ("Abyss Eye Booster Box") utan språkmarkör och lästes därför som ENGELSKA,
 * medan varje svensk butik skriver "(Japansk)". JP ≠ EN ⇒ den riktiga produkten föll
 * ur kandidatpoolen på VARJE annons, och första butiken som sålde varan skapade en
 * stub som BÄR "(JP)". Stubben blev sedan enda överlevande kandidat för alla
 * efterföljande butiker — en självmatande slinga.
 *
 * ⛔ DEN HÄR MERGAR **INTE** DEDUPENS ALLA FÖRSLAG. Stub-dedupen föreslog 83 par, och
 *    flera av dem är RIKTIGT OLIKA varor ("30th Celebration UPC" vs "Celebrations UPC",
 *    en ETB "B Grade – RIPPED SEAL" vs den hela). Den domen kräver ett mänskligt öga.
 *    Här mergas bara par vars ordmängder är IDENTISKA när språkmarkören och märkesordet
 *    strukits — dvs exakt den klass buggen tillverkade, och ingenting annat.
 *
 * ⛔ TVETYDIGHET MERGAS ALDRIG: hittas fler än en kandidat rapporteras stubben och
 *    hoppas över. Två kandidater betyder att katalogen har ett problem till, och att
 *    gissa mellan dem är hur man skriver offers på fel produkt.
 */
import { PrismaClient } from "@prisma/client";
import { mergeEquivalent, productsConflict } from "../src/scrapers/matching";
import { mergeStubInto, mergeWouldLoseTrackRecord } from "../src/jobs/dedupe-stubs";
import { isPokemonManufacturerGtin } from "../src/lib/gtin";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/**
 * Stryker språkmarkören ur titeln före ordmängds-jämförelsen.
 * ⛔ Bara ORDET försvinner — aldrig produktnamnet. "(JP)", "Japansk", "(ENG)".
 */
function stripLanguageWords(title: string): string {
  return title.replace(/\b(jpn?|japansk\w*|japanese|eng|engelsk\w*|english)\b/gi, " ");
}

/**
 * Inom kategorin BOOSTER_PACK bär ordet "pack" ingen identitet: Cardmarket namnger
 * en lös påse "Abyss Eye Booster", butikerna skriver "Abyss Eye Booster Pack".
 *
 * ⛔ BARA där, och bara när BÅDA sidorna är BOOSTER_PACK. En låda bär ordet "box"
 *    (eller "display", som MERGE_SYNONYMS redan slår ihop till box) och ligger i en
 *    annan kategori — så en påse kan aldrig slås ihop med sin display härifrån.
 * ⛔ ANTALET är orört: "3-pack" behåller sin trea, och productsConflict körs ändå på
 *    de OBEARBETADE titlarna, så unitCountMismatch vaktar vidare.
 */
function stripPackWord(title: string): string {
  return title.replace(/\b(packs?|paket)\b/gi, " ");
}

function comparableTitle(title: string, category: string): string {
  const t = stripLanguageWords(title);
  return category === "BOOSTER_PACK" ? stripPackWord(t) : t;
}

async function main() {
  const products = await prisma.product.findMany({
    where: { category: { notIn: ["SINGLE_CARD", "GRADED_CARD"] } },
    select: {
      id: true, title: true, slug: true, category: true, language: true,
      setId: true, cardId: true, gtin: true, createdAt: true,
      _count: { select: { offers: true, priceSnapshots: true } },
    },
  });
  const cmProductIds = new Set(
    (await prisma.offer.findMany({
      where: { retailer: { name: "Cardmarket" } },
      select: { productId: true },
    })).map((o) => o.productId)
  );

  const isStub = (p: (typeof products)[number]) =>
    p.setId == null && p.cardId == null && !cmProductIds.has(p.id) &&
    !(p.gtin && isPokemonManufacturerGtin(p.gtin));
  // "Etablerad" = har den meritlista stubben saknar: CM-koppling, streckkod eller set.
  const isEstablished = (p: (typeof products)[number]) =>
    cmProductIds.has(p.id) || !!(p.gtin && isPokemonManufacturerGtin(p.gtin)) || p.setId != null;

  const stubs = products.filter(isStub);
  console.log(`${products.length} sealed-produkter, ${stubs.length} med stub-signatur.\n`);

  const merged = new Set<string>();
  let pairs = 0, ambiguous = 0, skipped = 0;

  for (const stub of stubs) {
    if (merged.has(stub.id)) continue;
    const cands = products.filter(
      (c) =>
        c.id !== stub.id && !merged.has(c.id) &&
        c.category === stub.category &&
        isEstablished(c) &&
        mergeEquivalent(
          comparableTitle(stub.title, stub.category),
          comparableTitle(c.title, c.category)
        ) &&
        !productsConflict(stub.title, c.title, c.language)
    );
    if (cands.length === 0) continue;
    if (cands.length > 1) {
      ambiguous++;
      console.log(`TVETYDIG  "${stub.title}"  →  ${cands.map((c) => `"${c.title}"`).join("  |  ")}`);
      continue;
    }
    const target = cands[0];
    if (await mergeWouldLoseTrackRecord(stub.id, target.id)) {
      skipped++;
      console.log(`HOPPAR    "${stub.title}" → "${target.title}" (stubben har mer meritlista)`);
      continue;
    }
    pairs++;
    console.log(
      `${APPLY ? "MERGAR  " : "SKULLE  "}  "${stub.title}" (offers=${stub._count.offers}, snap=${stub._count.priceSnapshots})\n` +
      `            → "${target.title}" (offers=${target._count.offers}, snap=${target._count.priceSnapshots}, ${target.slug})`
    );
    if (APPLY) {
      await mergeStubInto(stub.id, target.id, () => {});
      merged.add(stub.id);
    }
  }

  console.log(
    `\n${APPLY ? "Mergade" : "Skulle merga"}: ${pairs}   tvetydiga: ${ambiguous}   hoppade: ${skipped}`
  );
  if (!APPLY) console.log("Torrkörning — inget skrevs. Kör med --apply.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
