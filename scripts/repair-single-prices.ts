/**
 * Riktad OMPRISSÄTTNING av enskilda singlar via CM-refreshens EGNA funktioner
 * (singlesHeadlineEur + guideNameMatches) — ett RapidAPI-anrop per kort.
 *
 * Finns för att kunna rätta en delmängd utan att bränna ~1100 anrop på en full
 * körning. Urvalet är produkter vars CM-pris ser fabricerat ut: antingen en
 * UPPSKATTNING (OUT_OF_STOCK, From saknades) eller ett pris som fallit minst
 * FACTOR mot sitt eget snitt före regeländringen.
 *
 * Skriver Offer.price/stockStatus/url + dagens snapshot (last-write-wins), exakt
 * som den dagliga körningen. Ingen ny prislogik bor här.
 *
 *   node scripts/with-prod-db.mjs npx tsx -r dotenv/config scripts/repair-single-prices.ts
 *   node scripts/with-prod-db.mjs npx tsx -r dotenv/config scripts/repair-single-prices.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { mapPool } from "../src/lib/concurrency";
import { getRatesOre } from "../src/lib/exchange-rate";
import { cardmarketProductUrl, isEnglishCardmarketUrl, withNearMint } from "../src/lib/marketplace-urls";
import { fetchCmGuide, fetchCmSingleNames, guideNameMatches, singlesHeadlineEur } from "../src/jobs/cardmarket-refresh";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FACTOR = Number(process.argv.find((a) => a.startsWith("--factor="))?.split("=")[1]) || 5;
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kr = (o: number | null) => (o == null ? "–" : `${(o / 100).toFixed(2)} kr`);

interface CmCard {
  cardmarket_id: number | null;
  name?: string | null;
  prices?: { cardmarket?: { lowest_near_mint?: number | null; "30d_average"?: number | null } | null } | null;
}

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  const db = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  console.log(`DB: ${db[0].current_database}   läge: ${APPLY ? "SKRIVER" : "TORRKÖRNING"}\n`);

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) throw new Error("Cardmarket-retailer saknas");

  const targets = await prisma.$queryRawUnsafe<
    { productId: string; offerId: string; tcgid: string; title: string; price: number; url: string; priorAvg: number }[]
  >(
    `WITH prior AS (
       SELECT "productId", AVG("avgPrice") AS avg_before
       FROM "PriceSnapshot"
       WHERE date >= date '2026-07-17' AND date < date '2026-07-24'
       GROUP BY "productId"
     )
     SELECT p.id AS "productId", o.id AS "offerId", c."tcgExternalId" AS tcgid,
            p.title, o.price, o.url, ROUND(prior.avg_before)::int AS "priorAvg"
     FROM "Offer" o
       JOIN "Product" p ON p.id = o."productId"
       JOIN "Card" c ON c.id = p."cardId"
       LEFT JOIN prior ON prior."productId" = p.id
     WHERE o."retailerId" = $1 AND p.category = 'SINGLE_CARD'
       AND p."variantLabel" IS NULL AND c."tcgExternalId" IS NOT NULL
       AND o.price IS NOT NULL AND o.price > 0
       AND (o."stockStatus" = 'OUT_OF_STOCK' OR prior.avg_before > o.price * $2::float)`,
    cm.id,
    FACTOR
  );
  console.log(`Kandidater att omprissätta: ${targets.length}  (≈${targets.length} API-anrop)\n`);
  if (targets.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const [rates, guide, cmNames] = await Promise.all([getRatesOre(), fetchCmGuide(), fetchCmSingleNames()]);
  let changed = 0, misId = 0, unchanged = 0, noData = 0;
  const ops: { productId: string; offerId: string; priceOre: number; from: boolean; url: string }[] = [];

  await mapPool(targets, 4, async (t) => {
    const r = await fetch(`https://${HOST}/pokemon/cards?tcgid=${encodeURIComponent(t.tcgid)}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    await sleep(880);
    if (!r.ok) return;
    const card = ((await r.json()) as { data: CmCard[] }).data?.[0];
    if (!card) { noData++; return; }
    const cmp = card.prices?.cardmarket ?? {};
    let g = card.cardmarket_id != null ? guide.get(card.cardmarket_id) : undefined;
    if (g && card.cardmarket_id != null && !guideNameMatches(cmNames.get(card.cardmarket_id), card.name)) {
      g = undefined;
      misId++;
    }
    const priced = singlesHeadlineEur({ from: cmp.lowest_near_mint, avg30: cmp["30d_average"] }, g);
    if (priced == null) { noData++; return; }
    const priceOre = Math.round(priced.eur * rates.eurToOre);
    const url = isEnglishCardmarketUrl(t.url)
      ? withNearMint(t.url)
      : card.cardmarket_id != null
        ? cardmarketProductUrl(card.cardmarket_id, { nearMint: true })
        : t.url;
    if (priceOre === t.price) { unchanged++; return; }
    changed++;
    if (changed <= 40)
      console.log(`  ${kr(t.price).padStart(12)} → ${kr(priceOre).padStart(12)}  (var ${kr(t.priorAvg)})  ${t.title}`);
    ops.push({ productId: t.productId, offerId: t.offerId, priceOre, from: priced.from, url });
  });

  console.log(`\n${changed} ändrade, ${unchanged} oförändrade, ${noData} utan data, ${misId} felmappade cardmarket_id.`);
  if (!APPLY) {
    console.log(`Torrkörning — inget skrivet. Kör med --apply.`);
    await prisma.$disconnect();
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await mapPool(ops, 8, async (op) => {
    await prisma.offer.update({
      where: { id: op.offerId },
      data: {
        price: op.priceOre,
        url: op.url,
        stockStatus: op.from ? "IN_STOCK" : "OUT_OF_STOCK",
        condition: "NEAR_MINT",
        lastSeenAt: new Date(),
      },
    });
    // Dagens historikpunkt skrivs om (last-write-wins) så grafen inte behåller
    // det felaktiga värdet från den tidigare körningen samma dygn.
    await prisma.priceSnapshot.upsert({
      where: { productId_date: { productId: op.productId, date: today } },
      update: { minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre },
      create: {
        productId: op.productId, date: today,
        minPrice: op.priceOre, maxPrice: op.priceOre, avgPrice: op.priceOre, volume: 1,
      },
    });
  });
  console.log(`✅ ${ops.length} offers och dagspunkter uppdaterade.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
