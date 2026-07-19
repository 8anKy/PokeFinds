/**
 * MARKNADS-UNDERPRIS-RAPPORT: marknadsplats-offers (Tradera) vars pris ligger under
 * 15 % av samma produkts Cardmarket-pris — vår definition av "bevisat falskt/spelat/
 * öppnat ex" (samma tröskel som ingest-vakten SEALED_MIN_PRICE_RATIO).
 *
 * Bakgrund: 2026-07-19 hittade ägaren "Ascended Heroes: Riolu Mini Tin" med en
 * 19 kr-Tradera-offer mot CM 223 kr. Ingest-vakten (isPlausibleListingPrice) jämför
 * mot CM-facit — men CM:s EGET pris glitchade lågt 9–13 juli, så annonsen slank
 * igenom I DET FÖNSTRET och låg kvar. Vakten kan aldrig fånga det retroaktivt:
 * den kör bara när annonsen skrivs. Den här rapporten kör mot NUVARANDE facit,
 * varje vecka, gratis och deterministiskt — överlevare från glitch-fönster syns här.
 *
 * Fix (manuellt/skript): radera offern på offer-ID, sätt TraderaMatch ok=false för
 * (itemId, productId) så svepet aldrig återskapar den, radera förgiftade
 * PriceObservations. Se Riolu-receptet 2026-07-19.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/marketplace-underprice-report.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/marketplace-underprice-report.ts --strict  # exit 1 om någon (CI)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STRICT = process.argv.includes("--strict");
/** Samma tröskel som ingest-vakten (SEALED_MIN_PRICE_RATIO i matching.ts). */
const MIN_RATIO = 0.15;

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    {
      offerId: string;
      price: number;
      url: string;
      cmPrice: number;
      title: string;
      slug: string;
      productId: string;
    }[]
  >(`
    SELECT t.id AS "offerId", t.price, t.url, cm.price AS "cmPrice",
           p.title, p.slug, p.id AS "productId"
    FROM "Offer" t
    JOIN "Retailer" rt ON rt.id = t."retailerId" AND rt.name = 'Tradera'
    JOIN "Product" p ON p.id = t."productId"
    JOIN "Offer" cm ON cm."productId" = t."productId" AND cm.price IS NOT NULL
    JOIN "Retailer" rc ON rc.id = cm."retailerId" AND rc.name = 'Cardmarket'
    WHERE t.price IS NOT NULL AND t.price > 0
      AND t.price < cm.price * ${MIN_RATIO}
    ORDER BY t.price::float / cm.price
  `);

  console.log(
    `\n=== TRADERA-OFFERS UNDER ${MIN_RATIO * 100}% AV CM-PRISET (falskt/spelat/öppnat ex) — ${rows.length} st ===`
  );
  if (rows.length === 0) console.log("  Inga. 🎉");
  for (const r of rows) {
    const itemId = r.url.match(/\/item\/\d+\/(\d+)/)?.[1] ?? "?";
    console.log(`\n  ✗ ${r.title}`);
    console.log(`      /produkter/${r.slug}`);
    console.log(`      Tradera ${(r.price / 100).toFixed(0)} kr mot CM ${(r.cmPrice / 100).toFixed(0)} kr  offer=${r.offerId}  itemId=${itemId}`);
    console.log(`      ${r.url.slice(0, 110)}`);
  }
  if (rows.length > 0) {
    console.log(
      `\n  → Radera offern (på offer-ID), sätt TraderaMatch ok=false för (itemId, productId),` +
        `\n    radera förgiftade PriceObservations. Se Riolu-receptet 2026-07-19.`
    );
  }

  if (STRICT && rows.length > 0) {
    console.error(`\nSTRICT: ${rows.length} underpris-offers → exit 1`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
