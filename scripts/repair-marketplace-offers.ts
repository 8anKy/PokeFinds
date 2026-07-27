/**
 * KARUSELL UTAN PRISRAD — laga de produkter där städningen tog offern och lämnade
 * annonserna.
 *
 * Symtomet på produktsidan: "Fler annonser på Tradera" visar en rad annonser,
 * men pristabellen har ingen Tradera-rad alls. Orsaken är alltid densamma — en
 * offer städades bort som bevisad felmatch (nummer-städningen 2026-07-25 tog 707
 * stycken, purge-mismatched-offer tar enstaka) utan att nästa vettiga annons ur
 * SAMMA redan vaktade kandidatlista lyftes fram. Svepet läker det av sig självt
 * nästa gång produkten namn-söks, men rotationen tar dagar och under tiden ser
 * sidan trasig ut.
 *
 * Skriptet väljer aldrig något svepet inte redan godkänt: kandidaterna är
 * skena-rader (kategori-, språk-, titel- och prisvaktade när de skrevs), utan
 * dömda felmatchningar, och de måste hålla mot produktens Cardmarket-pris.
 *
 * Dry-run som standard. APPLY=1 skriver.
 *   node scripts/with-prod-db.mjs npx tsx scripts/repair-marketplace-offers.ts
 *   APPLY=1 node scripts/with-prod-db.mjs npx tsx scripts/repair-marketplace-offers.ts
 *
 * Idempotent: när allt är lagat hittar den 0 produkter och gör ingenting.
 */
import { prisma } from "../src/lib/db";
import { recomputeProductPriceCache } from "../src/services/products";
import { findReplacementListing, writeMarketplaceOffer } from "../src/services/marketplace-offers";

const APPLY = process.env.APPLY === "1";
/** Skena-rader äldre än så visas inte på produktsidan — då finns inget att laga. */
const MAX_AGE_DAYS = 4;

async function main() {
  console.log(APPLY ? "LÄGE: SKRIVER\n" : "LÄGE: TORRKÖRNING (APPLY=1 för att skriva)\n");

  const tradera = await prisma.retailer.findFirstOrThrow({ where: { name: "Tradera" } });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);

  const candidates = await prisma.product.findMany({
    where: {
      traderaListings: { some: { lastSeenAt: { gte: cutoff } } },
      offers: { none: { retailerId: tradera.id, price: { not: null } } },
    },
    select: { id: true, slug: true, title: true, category: true },
  });
  console.log(`${candidates.length} produkter har karusell men ingen prissatt Tradera-rad.\n`);

  let fixed = 0, noCandidate = 0;
  for (const p of candidates) {
    const replacement = await findReplacementListing(p.id);
    if (!replacement) {
      noCandidate++;
      continue;
    }
    console.log(`• ${p.title}  (/produkter/${p.slug})`);
    console.log(`    → ${(replacement.price / 100).toFixed(2)} kr  "${replacement.title}"`);
    if (APPLY) {
      await writeMarketplaceOffer(p.id, tradera.id, p.category, replacement);
    }
    fixed++;
  }

  console.log(
    `\n${fixed} produkter ${APPLY ? "fick" : "skulle få"} tillbaka sin Tradera-rad. ` +
    `${noCandidate} hade ingen kandidat som håller mot facit (lämnas — hellre ingen rad än ett pris vi inte kan försvara).`
  );
  if (APPLY && fixed > 0) {
    await recomputeProductPriceCache();
    console.log("Prischachen omräknad.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
