/**
 * MÄTNING FÖRE PÅSLAG av de skärpta importvakterna (2026-08-08): kör de nya/ändrade
 * vakterna över HELA katalogen + alla butiks-offer-URL:ers titlar och listar vad som
 * flaggas. En träff på en RIKTIG produkt = falsk positiv som måste undantas innan
 * vakterna får skeppas (samma metod som samlarnummer-vakten 2026-08-07).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/measure-guards-2026-08-08.ts
 */
import { prisma } from "../src/lib/db";
import {
  isAccessoryListing,
  isOtherFranchiseListing,
  isStoreBundleListing,
  isUnspecifiedCharacterListing,
} from "../src/scrapers/matching";

const SEALED = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE", "COLLECTION_BOX", "TIN", "BLISTER", "OTHER"] as const;

async function main() {
  const products = await prisma.product.findMany({
    where: { category: { in: [...SEALED] } },
    select: { title: true, slug: true, category: true },
  });
  console.log(`${products.length} sealed-produkter i katalogen.\n`);

  const guards: [string, (t: string) => boolean][] = [
    ["isAccessoryListing", isAccessoryListing],
    ["isStoreBundleListing", isStoreBundleListing],
    ["isOtherFranchiseListing", isOtherFranchiseListing],
    ["isUnspecifiedCharacterListing (bara skapande-vägen)", isUnspecifiedCharacterListing],
  ];
  for (const [name, fn] of guards) {
    const hits = products.filter((p) => fn(p.title));
    console.log(`── ${name}: ${hits.length} träffar ──`);
    for (const h of hits) console.log(`   [${h.category}] ${h.title}   (${h.slug})`);
    console.log();
  }
}

main().finally(() => prisma.$disconnect());
