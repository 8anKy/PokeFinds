/**
 * ÄR VÅRA "I LAGER"-SHOPIFYERBJUDANDEN FAKTISKT KÖPBARA?
 *
 * Shopifys `available` betyder inte "går att köpa". Kortarkivets "Ascended Heroes
 * Booster Bundle (ME2.5)" stod `available: true` i products.json, i
 * /products/{handle}.js OCH i sidans JSON-LD medan storefronten visade "Slut i lager"
 * och renderade köpknappen `disabled` (utredning i stock-verify.ts). Vår produktsida
 * påstod alltså "i lager" om något ingen kunde köpa — ägaren hittade det 2026-08-15.
 *
 * `runRestockScan` slår numera upp butikens produktsida vid varje ÖVERGÅNG in i lager,
 * så nya fall uppstår inte. Men en offer som redan STÅR på IN_STOCK gör aldrig en
 * övergång igen — den ligger kvar och ljuger tills butiken själv flippar fältet. Det
 * här jobbet städar den kvarvarande stocken.
 *
 * ⛔ ROTERANDE BUDGET, INTE HELA STOCKEN. Det finns ~1 000 IN_STOCK-offers hos
 *    Shopify-butiker och en produktsida är ~500 kB — att hämta alla varje natt vore
 *    ~500 MB ur butikernas servrar för ett fel som mätt drabbar ~1 av 1 000. Varje
 *    körning tar `limit` stycken, valda på en STABIL skärva av offer-id + dygnsnumret,
 *    så hela stocken gås igenom över `shards` dygn utan att någon rad hoppas över.
 *    Ingen migration behövs (ingen `verifiedAt`-kolumn) — skärvan ÄR rotationen.
 *
 * ⛔ NULL = VET INTE ⇒ RÖR INGET. Ett 429, en 404 eller ett tema vi inte kan läsa är
 *    ingen ny upplysning. Bara ett uttryckligt "knappen är låst" skriver.
 * ⛔ SKRIVER ALDRIG IN_STOCK. Jobbet kan bara ta BORT ett falskt "i lager"; att sätta
 *    tillbaka det är feedens jobb, och den vägen larmar korrekt.
 */
import { StockStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchShopifyPurchasable } from "@/scrapers/stock-verify";

export interface VerifyInStockResult {
  candidates: number;
  checked: number;
  fixed: number;
  unknown: number;
  fixedUrls: string[];
}

/** Stabil skärva ur ett cuid: sista fyra tecknen i bas 36. */
function shardOf(id: string, shards: number): number {
  const tail = id.slice(-4);
  let n = 0;
  for (const ch of tail) n = (n * 36 + (parseInt(ch, 36) || 0)) % 1_000_003;
  return n % shards;
}

export async function verifyInStockBuyable(opts?: {
  /** Butiker vars annonser kan kontrolleras (Shopify). Anroparen äger klassningen. */
  storeNames: string[];
  limit?: number;
  shards?: number;
  /** Vilken skärva som körs. Default = dygnsnummer, dvs full rotation på `shards` dygn. */
  shard?: number;
  apply?: boolean;
}): Promise<VerifyInStockResult> {
  const storeNames = opts?.storeNames ?? [];
  const limit = opts?.limit ?? 120;
  const shards = Math.max(1, opts?.shards ?? 7);
  const shard =
    opts?.shard ?? Math.floor(Date.now() / (24 * 3600 * 1000)) % shards;
  const apply = opts?.apply ?? false;

  if (storeNames.length === 0) {
    return { candidates: 0, checked: 0, fixed: 0, unknown: 0, fixedUrls: [] };
  }

  const retailers = await prisma.retailer.findMany({
    where: { name: { in: storeNames } },
    select: { id: true, name: true },
  });
  const nameById = new Map(retailers.map((r) => [r.id, r.name]));

  const offers = await prisma.offer.findMany({
    where: {
      retailerId: { in: retailers.map((r) => r.id) },
      stockStatus: StockStatus.IN_STOCK,
    },
    select: { id: true, url: true, retailerId: true, productId: true },
  });

  const mine = offers.filter((o) => shardOf(o.id, shards) === shard).slice(0, limit);
  let fixed = 0;
  let unknown = 0;
  const fixedUrls: string[] = [];

  for (const o of mine) {
    const purchasable = await fetchShopifyPurchasable(o.url);
    if (purchasable === null) {
      unknown++;
      continue;
    }
    if (purchasable) continue;
    fixed++;
    fixedUrls.push(`${nameById.get(o.retailerId) ?? o.retailerId}: ${o.url}`);
    if (apply) {
      await prisma.offer.update({
        where: { id: o.id },
        data: { stockStatus: StockStatus.OUT_OF_STOCK },
      });
      // Ingen RestockEvent och inget larm: det här är en RÄTTELSE av ett felaktigt
      // tillstånd, inte en lagerhändelse. Skrivs den som en händelse hamnar den i
      // flapp-historiken och kan tysta nästa ÄKTA påfyllning.
    }
  }

  return { candidates: offers.length, checked: mine.length, fixed, unknown, fixedUrls };
}
