/**
 * KÖR GUIDE-RESERVEN PÅ REDAN FRUSNA KORT — utan att röra RapidAPI-kvoten.
 *
 * Den dagliga körningen har reserven inbyggd (`runCardmarketRefresh`), och det är
 * den som ska göra jobbet i normalfallet. Det här skriptet finns för när kvoten är
 * slut men korten redan är bevisat frusna: har en CM-offer inte rörts på ≥N dygn
 * har feeden per definition inte prissatt kortet, så reservens villkor är uppfyllt
 * utan att man behöver hämta feeden en gång till för att bevisa det.
 *
 * ⛔ RÖR ALDRIG KORT FEEDEN FAKTISKT PRISSÄTTER. Hela grinden är `lastSeenAt` —
 *    den bumpas varje gång en körning hittar kortet. STALE_DAYS får därför aldrig
 *    sättas så lågt att gårdagens normala körning ryms i fönstret; standard 3 är
 *    tre missade dygn i rad.
 * ⛔ SAMMA DOM SOM DEN DAGLIGA KÖRNINGEN. Priset går genom `guideReserveEur` →
 *    `singlesHeadlineEur`, dvs identitetsvakterna och uppskattningspolicyn är
 *    exakt desamma. Ingen egen prislogik bor här.
 * ⛔ TRYCKNINGAR UNDANTAS (delar CM-produkt ⇒ en guide-rad hade gett två poster
 *    samma värde).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-guide-reserve.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-guide-reserve.ts --apply
 *
 * Env: STALE_DAYS=3
 */
import { prisma } from "../src/lib/db";
import {
  fetchCmGuide,
  fetchCmSingleNames,
  guideReserveEur,
  upsertTodaySnapshots,
} from "../src/jobs/cardmarket-refresh";
import { getRatesOre } from "../src/lib/exchange-rate";
import { isPrintVariantLabel } from "../src/lib/print-variant";
import { utcToday } from "../src/lib/utils";

const APPLY = process.argv.includes("--apply");
const STALE_DAYS = Number(process.env.STALE_DAYS) || 3;

async function main() {
  const [cm, cmSource] = await Promise.all([
    prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
    prisma.scrapeSource.findFirst({ where: { name: "Cardmarket" }, select: { id: true } }),
  ]);
  if (!cm || !cmSource) throw new Error("Cardmarket saknas som retailer/källa");

  const frozen = await prisma.$queryRaw<
    {
      productId: string;
      title: string;
      cardName: string | null;
      cardmarketId: number | null;
      variantLabel: string | null;
      offerId: string;
      priceOre: number | null;
      url: string;
    }[]
  >`
    SELECT p.id AS "productId", p.title, c.name AS "cardName",
           c."cardmarketId" AS "cardmarketId", p."variantLabel" AS "variantLabel",
           o.id AS "offerId", o.price AS "priceOre", o.url
    FROM "Product" p
    JOIN "Offer" o ON o."productId" = p.id AND o."retailerId" = ${cm.id}
    LEFT JOIN "Card" c ON c.id = p."cardId"
    WHERE p.category = 'SINGLE_CARD'
      AND o."lastSeenAt" < NOW() - (${STALE_DAYS} || ' days')::interval
    ORDER BY p.title
  `;

  const [guide, cmNames, rates] = await Promise.all([
    fetchCmGuide(),
    fetchCmSingleNames(),
    getRatesOre(),
  ]);
  if (cmNames.size === 0) throw new Error("CM:s singelkatalog gick inte att hämta — avbryter");

  const ops: { productId: string; offerId: string; priceOre: number; title: string; oldOre: number | null }[] = [];
  const skips: Record<string, number> = {};
  const bump = (k: string) => (skips[k] = (skips[k] ?? 0) + 1);

  for (const f of frozen) {
    if (isPrintVariantLabel(f.variantLabel)) { bump("tryckning"); continue; }
    if (!f.cardName) { bump("inget kortnamn"); continue; }
    const linked = Number(f.url.match(/idProduct=(\d+)/)?.[1] ?? NaN);
    const idProduct = Number.isFinite(linked) ? linked : f.cardmarketId;
    if (idProduct == null) { bump("inget idProduct"); continue; }
    const v = guideReserveEur({ cardName: f.cardName, idProduct }, guide.get(idProduct), cmNames);
    if ("reject" in v) { bump(v.reject); continue; }
    ops.push({
      productId: f.productId,
      offerId: f.offerId,
      priceOre: Math.round(v.eur * rates.eurToOre),
      title: f.title,
      oldOre: f.priceOre,
    });
  }

  console.log(`Frusna CM-offers (≥${STALE_DAYS} dygn): ${frozen.length}`);
  console.log(`Kan prissättas ur CM:s guide: ${ops.length}`);
  for (const [k, n] of Object.entries(skips).sort((a, b) => b[1] - a[1]))
    console.log(`  – ${k}: ${n}`);
  console.log();
  for (const o of ops)
    console.log(
      "  ",
      o.title.slice(0, 52).padEnd(52),
      (o.oldOre != null ? (o.oldOre / 100).toFixed(2) : "–").padStart(10),
      "→",
      (o.priceOre / 100).toFixed(2).padStart(10)
    );

  if (!APPLY) {
    console.log(`\nTORRKÖRNING — inget skrivet. --apply skriver ${ops.length} priser + historikpunkter.`);
    return;
  }
  const today = utcToday();
  for (const o of ops)
    await prisma.offer.update({
      where: { id: o.offerId },
      // OUT_OF_STOCK = uppskattning, ingen känd köpbar annons. Samma semantik som
      // den dagliga körningen sätter för `from: false` — rubriken byter då till
      // "Uppskattat värde · ingen aktiv annons".
      data: { price: o.priceOre, stockStatus: "OUT_OF_STOCK", condition: "NEAR_MINT", lastSeenAt: new Date() },
    });
  await prisma.priceObservation.createMany({
    data: ops.map((o) => ({ productId: o.productId, sourceId: cmSource.id, price: o.priceOre, currency: "SEK" })),
  });
  await upsertTodaySnapshots(ops, today);
  console.log(`\n✅ ${ops.length} priser + historikpunkter skrivna (${today.toISOString().slice(0, 10)}).`);
}

main()
  .catch((e) => {
    console.error("FEL:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
