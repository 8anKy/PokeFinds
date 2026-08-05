/**
 * STÄDA BORT NOLLPRISER — offers, observationer och snapshots på 0.
 *
 * Ett pris på 0 kr är ett påstående om marknaden som aldrig varit sant. "–" läses
 * som "vi vet inte"; "0 kr" läses som "gratis". Skrivvägen är tätad sedan
 * 2026-08-05 (`priceOreFromEur`) — det här rensar vad som hann skrivas innan dess.
 *
 * Ursprunget: RapidAPI publicerar `"30d_average": 0` för kort utan engelska
 * annonser (mätt på np-4 Grovyle · Nintendo Black Star Promos), och före
 * median-uppskattningen 2026-07-25 gick nollan rakt igenom.
 *
 * ⛔ OFFERN RADERAS INTE — priset sätts till NULL. Länken till Cardmarket är
 *    fortfarande riktig och värd att visa; det är bara talet som är fel.
 *    Länk-offer utan pris är en stödd form (isDirectOfferUrl godkänner den,
 *    produktsidan visar "–").
 * ⛔ OBSERVATIONER/SNAPSHOTS PÅ 0 RADERAS. De ritar en krasch till noll i grafen,
 *    och till skillnad från offern finns inget "rätt" värde att sätta i stället —
 *    mätningen ägde aldrig rum. Samma hållning som purge-fabricated-day.ts.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-zero-prices.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/purge-zero-prices.ts --apply
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const offers = await prisma.$queryRaw<
    { id: string; title: string; retailer: string; url: string }[]
  >`
    SELECT o.id, p.title, r.name AS retailer, o.url
    FROM "Offer" o
    JOIN "Product" p ON p.id = o."productId"
    JOIN "Retailer" r ON r.id = o."retailerId"
    WHERE o.price = 0
    ORDER BY p.title
  `;
  const obs = await prisma.$queryRaw<{ title: string; n: bigint }[]>`
    SELECT p.title, COUNT(*)::bigint AS n
    FROM "PriceObservation" o JOIN "Product" p ON p.id = o."productId"
    WHERE o.price = 0 GROUP BY 1 ORDER BY n DESC
  `;
  const snaps = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "PriceSnapshot" WHERE "avgPrice" = 0
  `;

  console.log(`Offers med pris 0 (sätts till NULL): ${offers.length}`);
  for (const o of offers) console.log(`   ${o.retailer.padEnd(12)} ${o.title}`);
  const obsTotal = obs.reduce((a, r) => a + Number(r.n), 0);
  console.log(`\nPriceObservation med pris 0 (raderas): ${obsTotal} på ${obs.length} produkter`);
  for (const r of obs.slice(0, 20)) console.log(`   x${String(Number(r.n)).padStart(3)}  ${r.title}`);
  console.log(`\nPriceSnapshot med avgPrice 0 (raderas): ${Number(snaps[0]?.n ?? 0)}`);

  if (!APPLY) {
    console.log("\nTORRKÖRNING — inget skrivet. Kör om med --apply.");
    return;
  }
  const o = await prisma.offer.updateMany({ where: { price: 0 }, data: { price: null } });
  const po = await prisma.priceObservation.deleteMany({ where: { price: 0 } });
  const ps = await prisma.priceSnapshot.deleteMany({ where: { avgPrice: 0 } });
  console.log(`\n✅ ${o.count} offers nollställda till "–", ${po.count} observationer och ${ps.count} snapshots raderade.`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
