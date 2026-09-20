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
 * Urval: offers hos BEVAKADE butiker (restockWatch) som inte setts i feeden på > 24 h.
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

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const STORE = process.argv.find((a) => a.startsWith("--store="))?.slice("--store=".length);
const GRACE_H = Number(process.env.RESTOCK_SOLDOUT_GRACE_HOURS ?? 24);
const MAX = Number(process.argv.find((a) => a.startsWith("--max="))?.slice("--max=".length) ?? 300);

const CLAIMS: StockStatus[] = [StockStatus.IN_STOCK, StockStatus.PREORDER, StockStatus.LIMITED];

async function main() {
  await ensureDbAwake();
  const sources = await prisma.scrapeSource.findMany({ where: { isActive: true } });
  const watched = new Set(
    sources
      .filter((s) => (s.config as { restockWatch?: boolean } | null)?.restockWatch === true)
      .map((s) => s.name)
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
  console.log(`${offers.length} försvunna offers (${ALL ? "alla statusar" : "bara påståenden"}) hos ${retailers.length} bevakade butiker, ${APPLY ? "SKRIVER" : "torrkörning"}.`);

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
  if (APPLY && changed + unknown > 0) {
    console.log("Priscachen räknas om av nattkedjan; kör recompute om produktsidorna ska visa det direkt.");
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
