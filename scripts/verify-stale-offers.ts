/**
 * VERIFIERA FÖRSVUNNA OFFERS NU — samma dom som nattstegets verify-pass, men för hand.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-stale-offers.ts            # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-stale-offers.ts --apply
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-stale-offers.ts --store=Goblinen --all
 *
 * VARFÖR: 2026-09-20 stod Goblinens 30th Celebration-ETB "I lager" på produktsidan fyra
 * dygn efter att butiken avpublicerat sidan (404). Nattstegets verify-pass hade ett tak
 * på 20 offers/körning mot en kö på ~200, ren ålderskö, och 404 gav "vet inte". Taket och
 * ordningen är lagade i runnern; det här skriptet tar ikapp backloggen och är verktyget
 * nästa gång en rad ser stale ut.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/verify-stale-offers.ts --unwatched --apply
 *
 * Urval: offers hos BEVAKADE butiker (restockWatch) som inte setts i feeden på > 24 h.
 * `--unwatched` tar i stället de AKTIVA butikerna som INTE är bevakade (Rogerz,
 * Pokexclusive …) — nattstegets verify-pass når dem aldrig, eftersom det bara hämtar de
 * bevakade butikernas feedar. Deras offers bumpas av nattens `runScrapeJob`, så en rad
 * som inte setts på > karensen har fallit ur feeden (mätt 09-23: Rogerz 58 "I lager"
 * sedan 09-20). Marknadsplatser (Tradera, Cardmarket, CardTrader) räknas aldrig — de har
 * egna jobb och en annan mening för `lastSeenAt`. Körs som steg i scrape-all.
 * Default bara PÅSTÅENDEN (IN_STOCK/PREORDER/LIMITED) — det är de som ljuger för kunden;
 * `--all` tar även OUT/UNKNOWN (så en tyst återkomst upptäcks).
 *
 * Skriver EXAKT som runnern: status + lastSeenAt, RestockEvent för äkta övergångar.
 * ⛔ Inga larm härifrån — IN→OUT larmar aldrig, och en OUT→IN som hittas här ska
 * gå via nattkedjan/lanen med sina flapp-vakter, inte via ett handkört skript.
 */
import "./load-env";
import { StockStatus } from "@prisma/client";
import { prisma, ensureDbAwake } from "../src/lib/db";
import { statusAfterVerify, verifyStockForUrl } from "../src/scrapers/stock-verify";
import { netStockEvent } from "../src/scrapers/restock";
import { isStoreRetailer } from "../src/lib/offer-source";
import { recomputeProductPriceCache } from "../src/services/products";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const UNWATCHED = process.argv.includes("--unwatched");
const STORE = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const GRACE_H = Number(process.env.RESTOCK_SOLDOUT_GRACE_HOURS ?? 24);
const MAX = Number(process.argv.find((a) => a.startsWith("--max="))?.slice("--max=".length) ?? 300);

const CLAIMS: StockStatus[] = [StockStatus.IN_STOCK, StockStatus.PREORDER, StockStatus.LIMITED];

async function main() {
  await ensureDbAwake();
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const isWatched = (s: (typeof sources)[number]) =>
    (s.config as { restockWatch?: boolean } | null)?.restockWatch === true;
  const watched = new Set(
    sources.filter((s) => (UNWATCHED ? !isWatched(s) && isStoreRetailer(s.name) : isWatched(s))).map((s) => s.name)
  );
  const retailers = await prisma.retailer.findMany({
    where: { name: { in: [...watched] }, ...(STORE ? { name: STORE } : {}) },
    select: { id: true, name: true },
  });
  const nameById = new Map(retailers.map((r) => [r.id, r.name]));
  const cutoff = new Date(Date.now() - GRACE_H * 3600_000);
  const offers = await prisma.offer.findMany({
    where: {
      retailerId: { in: retailers.map((r) => r.id) },
      lastSeenAt: { lt: cutoff },
      ...(ALL ? {} : { stockStatus: { in: CLAIMS } }),
    },
    select: {
      id: true, url: true, productId: true, retailerId: true, stockStatus: true, lastSeenAt: true,
      product: { select: { title: true, hiddenAt: true } },
    },
    orderBy: { lastSeenAt: "asc" },
    take: MAX,
  });
  console.log(`${offers.length} försvunna offers (${ALL ? "alla statusar" : "bara påståenden"}) hos ${retailers.length} ${UNWATCHED ? "obevakade" : "bevakade"} butiker, ${APPLY ? "SKRIVER" : "torrkörning"}.`);

  let changed = 0, unknown = 0, same = 0;
  const now = new Date();
  for (const o of offers) {
    const store = nameById.get(o.retailerId) ?? "?";
    const truth = await verifyStockForUrl(store, o.url);
    const next = statusAfterVerify(o.stockStatus, truth);
    const tag = truth === null ? "utan svar" : `butiken: ${truth}`;
    if (next === o.stockStatus) {
      same++;
      console.log(`  = ${store.padEnd(18)} ${o.stockStatus.padEnd(12)} (${tag}) ${o.product.title.slice(0, 48)}`);
    } else {
      if (truth === null) unknown++; else changed++;
      console.log(`  ${APPLY ? "✎" : "→"} ${store.padEnd(18)} ${o.stockStatus} → ${next} (${tag}) ${o.product.title.slice(0, 48)}  ${o.url}`);
    }
    if (!APPLY) continue;
    if (next !== o.stockStatus) {
      const ev = netStockEvent(o.stockStatus, next);
      if (ev.emit && o.product.hiddenAt == null) {
        await prisma.restockEvent.create({
          data: { productId: o.productId, retailerId: o.retailerId, oldStatus: ev.oldStatus, newStatus: next, price: null },
        });
      }
    }
    await prisma.offer.update({ where: { id: o.id }, data: { stockStatus: next, lastSeenAt: now } });
  }
  console.log(`\nKlart: ${changed} rättade av butikens svar, ${unknown} → UNKNOWN (utan svar), ${same} oförändrade.`);
  // Priscachen föredrar I LAGER — en flippad offer kan ändra rubrikpriset. Nattstegets
  // omräkning har redan kört när det här steget kör, så räkna om här.
  if (APPLY && changed + unknown > 0) {
    await recomputeProductPriceCache();
    console.log("Priscachen omräknad.");
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
