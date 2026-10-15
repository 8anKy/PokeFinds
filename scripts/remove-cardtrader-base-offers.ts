/**
 * CARDTRADER BORT FRÅN KORT SOM HAR ETT CARDMARKET-PRIS (ägarbeslut 2026-10-15).
 *
 * `cardtrader-reverse.ts` skrev förut CardTraders golv som en egen offer på det
 * ordinarie kortet. Den tog rubriken på ~1 000 kort där den låg under CM:s From
 * (och på Gardevoir LV.X · Secret Wonders: 5 519 kr när CM-priset var uppskattat).
 * Jobbet skriver inte längre offern; det här skriptet tar bort de befintliga.
 *
 * Rör BARA CardTrader-offers på produkter som har en prissatt Cardmarket-offer.
 * Varianterna (reverse holo, bollmönster, 1st Edition) saknar CM-produkt och
 * behåller sitt CardTrader-pris. Prishistoriken (PriceObservation) rörs inte —
 * produktsidan ritar helt enkelt inte CardTrader-linjen där CM har ett pris.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/remove-cardtrader-base-offers.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/remove-cardtrader-base-offers.ts --apply
 */
import { prisma } from "@/lib/db";
import { recomputeProductPriceCache } from "@/services/products";
import { exitJob } from "@/lib/job-exit";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows: { id: string; productId: string }[] = await prisma.$queryRaw`
    SELECT o.id, o."productId"
    FROM "Offer" o
    JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'CardTrader'
    WHERE EXISTS (
      SELECT 1 FROM "Offer" c JOIN "Retailer" cr ON cr.id = c."retailerId" AND cr.name = 'Cardmarket'
      WHERE c."productId" = o."productId" AND c.price > 0
    )`;
  const headlineHeld: { n: number }[] = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "Offer" o
    JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'CardTrader'
    JOIN "Product" p ON p.id = o."productId" AND p."lowestPriceOre" = o.price
    WHERE EXISTS (
      SELECT 1 FROM "Offer" c JOIN "Retailer" cr ON cr.id = c."retailerId" AND cr.name = 'Cardmarket'
      WHERE c."productId" = o."productId" AND c.price > 0
    )`;
  console.log(`${rows.length} CardTrader-offers på kort med Cardmarket-pris (${headlineHeld[0]?.n ?? 0} av dem bär rubrikpriset i dag).`);
  if (!apply) {
    console.log("Torrkörning — kör med --apply för att ta bort dem.");
    return;
  }
  let deleted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const ids = rows.slice(i, i + 1000).map((r) => r.id);
    deleted += (await prisma.offer.deleteMany({ where: { id: { in: ids } } })).count;
  }
  console.log(`Tog bort ${deleted} offers. Räknar om rubrikpriserna …`);
  await recomputeProductPriceCache();
  console.log("Klart.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => exitJob());
