/**
 * ÅTERSTÄLLER de singel-priser som `cm-range-audit.ts --apply` skrev om till CM:s
 * guide-MEDIAN, tillbaka till det `lowest_near_mint` den dagliga körningen publicerade.
 *
 * Bakgrund 2026-07-27: reparationsläget i cm-range-audit band identiteten på ett
 * NORMALISERAT namn, och normaliseringen fäller ihop olika CM-produkter — vårt
 * "Rayquaza ★" blev "rayquaza" och matchade CM:s vanliga Rayquaza i EX Deoxys i stället
 * för Rayquaza Gold Star. Kortets riktiga NM-engelska lägsta (37 000 € = 409 220 kr)
 * skrevs därför ner till guide-medianen för ett helt annat kort: 215,61 kr. 160 rader
 * skrevs i samma svep, alla klockan 22:11 UTC den 2026-07-26.
 *
 * FACIT ÄR VÅR EGEN HISTORIK. Varje drabbad produkt har en CM-observation FÖRE fönstret
 * — värdet den dagliga RapidAPI-körningen publicerade samma dygn. Det är feedens From,
 * alltså exakt det ägarens regel säger ska stå. Ingen RapidAPI-kvot behövs.
 *
 * Tre skrivningar per produkt, alla omvändningar av vad --apply gjorde:
 *   1. Offer.price  →  värdet före fönstret   (lastSeenAt rörs inte — vi såg ingen annons)
 *   2. den fabricerade PriceObservation raderas  (produktgrafen läser dem direkt)
 *   3. dygnets PriceSnapshot  →  värdet före fönstret
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/revert-guide-median-prices.ts
 *   node scripts/with-prod-db.mjs npx tsx scripts/revert-guide-median-prices.ts --apply
 *   --from=2026-07-26T22:05:00Z --to=2026-07-26T23:00:00Z   (default = körningen ovan)
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const arg = (f: string) => process.argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=");
const FROM = arg("from") ?? "2026-07-26T22:05:00Z";
const TO = arg("to") ?? "2026-07-26T23:00:00Z";
const kr = (o: number) => `${(o / 100).toFixed(2)} kr`;

async function main() {
  const from = new Date(FROM), to = new Date(TO);
  console.log(`Fönster: ${from.toISOString()} → ${to.toISOString()}   läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}\n`);

  // Fabricerade punkter + värdet som gällde omedelbart före fönstret. `DISTINCT ON` tar
  // den SENASTE CM-observationen före fönstret, dvs dagens riktiga refresh-värde.
  const rows = await prisma.$queryRaw<
    { obsId: string; productId: string; title: string; slug: string; badOre: number; goodOre: number; offerId: string; offerOre: number | null }[]
  >`
    WITH bad AS (
      SELECT po.id AS "obsId", po."productId", po.price AS "badOre"
      FROM "PriceObservation" po
      JOIN "ScrapeSource" s ON s.id = po."sourceId" AND s.name = 'Cardmarket'
      JOIN "Product" p ON p.id = po."productId" AND p.category = 'SINGLE_CARD'
      WHERE po."observedAt" >= ${from} AND po."observedAt" < ${to}
    ),
    prior AS (
      SELECT DISTINCT ON (po."productId") po."productId", po.price AS "goodOre"
      FROM "PriceObservation" po
      JOIN "ScrapeSource" s ON s.id = po."sourceId" AND s.name = 'Cardmarket'
      WHERE po."observedAt" < ${from} AND po.price > 0
        AND po."productId" IN (SELECT "productId" FROM bad)
      ORDER BY po."productId", po."observedAt" DESC
    )
    SELECT bad."obsId", bad."productId", p.title, p.slug, bad."badOre", prior."goodOre",
           o.id AS "offerId", o.price AS "offerOre"
    FROM bad
      JOIN prior ON prior."productId" = bad."productId"
      JOIN "Product" p ON p.id = bad."productId"
      JOIN "Offer" o ON o."productId" = bad."productId"
      JOIN "Retailer" r ON r.id = o."retailerId" AND r.name = 'Cardmarket'
    ORDER BY prior."goodOre"::float / GREATEST(bad."badOre", 1) DESC`;

  const orphans = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "PriceObservation" po
    JOIN "ScrapeSource" s ON s.id = po."sourceId" AND s.name = 'Cardmarket'
    JOIN "Product" p ON p.id = po."productId" AND p.category = 'SINGLE_CARD'
    WHERE po."observedAt" >= ${from} AND po."observedAt" < ${to}
      AND NOT EXISTS (
        SELECT 1 FROM "PriceObservation" q
        JOIN "ScrapeSource" s2 ON s2.id = q."sourceId" AND s2.name = 'Cardmarket'
        WHERE q."productId" = po."productId" AND q."observedAt" < ${from} AND q.price > 0
      )`;

  console.log(`Fabricerade punkter med känt föregående värde: ${rows.length}`);
  if (Number(orphans[0]?.n ?? 0) > 0)
    console.log(`⚠ ${orphans[0].n} punkter SAKNAR föregående CM-observation → rörs inte (nästa dagliga körning sätter dem).`);
  console.log();
  for (const r of rows.slice(0, 25))
    console.log(`  ${kr(r.badOre).padStart(14)} → ${kr(r.goodOre).padStart(14)}   ${r.title}\n        /produkter/${r.slug}`);
  if (rows.length > 25) console.log(`  … ${rows.length - 25} till`);

  if (!APPLY || rows.length === 0) {
    if (!APPLY) console.log(`\nTorrkörning — inget skrivet. Kör med --apply.`);
    await prisma.$disconnect();
    return;
  }

  let offers = 0, snaps = 0;
  for (const r of rows) {
    if (r.offerOre !== r.goodOre) {
      // lastSeenAt rörs INTE: vi rättar en siffra, vi har inte sett en ny annons — och
      // täckningsvakten ska fortsätta kunna se om kortet slutat uppdateras.
      await prisma.offer.update({ where: { id: r.offerId }, data: { price: r.goodOre } });
      offers++;
    }
    const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const res = await prisma.priceSnapshot.updateMany({
      where: { productId: r.productId, date: day },
      data: { minPrice: r.goodOre, maxPrice: r.goodOre, avgPrice: r.goodOre },
    });
    snaps += res.count;
  }
  const del = await prisma.priceObservation.deleteMany({ where: { id: { in: rows.map((r) => r.obsId) } } });
  await recomputeProductPriceCache();
  console.log(`\n✅ ${offers} offer-priser återställda, ${del.count} fabricerade observationer raderade, ${snaps} snapshots rättade. Prischachen omräknad.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
