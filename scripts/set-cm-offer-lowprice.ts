/**
 * ⚠️ FÖRÅLDRAD (2026-06-13): vi visar nu Cardmarket-TREND (marknadspris) på
 * singlar, inte lowPrice. lowPrice är CM:s all-språk/all-skick-golv och
 * underskattade grovt det engelska priset (€1 vs €4 "From"). KÖR INTE detta —
 * använd `scripts/rebuild-cm-singles.ts` (trendPrice). Behålls för historik.
 *
 * Sätter Cardmarket-erbjudandets pris på SINGELKORT till lägsta annonspris
 * ("From" = cardmarket lowPrice) i stället för trend-priset.
 *
 * "Lägsta pris just nu" ska visa vad kortet faktiskt går att köpa för, inte
 * marknadens trend. Prishistoriken/grafen är OFÖRÄNDRAD (den bygger på
 * PriceObservation/PriceSnapshot = trend) — bara Offer.price ändras.
 *
 * Källa: senaste PriceObservation per produkt som har
 * rawData.cardmarket.prices.lowPrice (lagrad av import-tcg-data). EUR→öre ×1150.
 *
 * Körs:  npx tsx scripts/set-cm-offer-lowprice.ts        (dry-run)
 *        APPLY=1 npx tsx scripts/set-cm-offer-lowprice.ts (skriv)
 */
import { PrismaClient } from "@prisma/client";
import { getRatesOre } from "../src/lib/exchange-rate";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

async function main() {
  const { eurToOre } = await getRatesOre();
  console.log(`Kurs: 1 EUR = ${(eurToOre / 100).toFixed(3)} SEK`);

  const cm = await prisma.retailer.findFirstOrThrow({
    where: { name: "Cardmarket" },
    select: { id: true },
  });

  // Senaste lowPrice (öre) per produkt ur rådatan.
  const rows = await prisma.$queryRawUnsafe<{ productId: string; lowOre: number }[]>(`
    SELECT DISTINCT ON (po."productId")
      po."productId",
      ROUND((po."rawData"->'cardmarket'->'prices'->>'lowPrice')::numeric * ${eurToOre})::int AS "lowOre"
    FROM "PriceObservation" po
    WHERE po."rawData"->'cardmarket'->'prices'->>'lowPrice' IS NOT NULL
    ORDER BY po."productId", po."observedAt" DESC
  `);
  const lowByProduct = new Map(rows.map((r) => [r.productId, r.lowOre]));
  console.log(`Produkter med lowPrice i rådata: ${lowByProduct.size}`);

  // Alla CM-offers på singelkort.
  const offers = await prisma.offer.findMany({
    where: { retailerId: cm.id, product: { category: "SINGLE_CARD" } },
    select: { id: true, price: true, productId: true },
  });

  let changed = 0;
  let unchanged = 0;
  let noData = 0;
  const updates: { id: string; from: number | null; to: number }[] = [];

  for (const o of offers) {
    const low = lowByProduct.get(o.productId);
    if (low == null || low <= 0) {
      noData++;
      continue;
    }
    if (o.price === low) {
      unchanged++;
      continue;
    }
    changed++;
    updates.push({ id: o.id, from: o.price, to: low });
  }

  console.log(`CM singel-offers:            ${offers.length}`);
  console.log(`→ ändras till lowPrice:      ${changed}`);
  console.log(`→ redan rätt:                ${unchanged}`);
  console.log(`→ saknar lowPrice (orört):   ${noData}`);

  const sample = updates.slice(0, 5);
  for (const s of sample) {
    console.log(`   ex: ${(s.from ?? 0) / 100} kr → ${s.to / 100} kr`);
  }

  if (!APPLY) {
    console.log("\nDry-run. Kör med APPLY=1 för att skriva.");
    return;
  }

  let done = 0;
  for (const u of updates) {
    await prisma.offer.update({
      where: { id: u.id },
      data: { price: u.to, stockStatus: "IN_STOCK" },
    });
    done++;
    if (done % 500 === 0) console.log(`  uppdaterade ${done}/${updates.length}`);
  }
  console.log(`\nKlart: ${done} CM-offers satta till lägsta annonspris.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
